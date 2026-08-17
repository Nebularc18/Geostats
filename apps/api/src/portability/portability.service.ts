import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@geostats/db";
import {
  AuthUser,
  ImportFileType,
  ImportSource,
  ImportStatus,
} from "@geostats/shared";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaService } from "../common/prisma.service";
import { StorageService } from "../storage/storage.service";

const FORMAT = "geostats-portable-data";
const VERSION = 1;
const MAX_RECORDS = 1_000_000;
const IMPORT_SOURCES = new Set([
  "MY_FINDS_GPX",
  "MY_HIDES_GPX",
  "POCKET_QUERY",
  "MANUAL_GPX",
  "GEOCACHING_API",
]);
const WRITE_BATCH_SIZE = 500;
const MAX_MYSTERY_WORKSPACES = 500;
const MAX_MYSTERY_BYTES = 256 * 1024;
const OBJECT_CLEANUP_INTERVAL_MS = 60_000;
const OBJECT_CLEANUP_BATCH_SIZE = 100;

type PortableArchive = {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  account: { username: string; email: string; createdAt: string };
  data: {
    profile: any | null;
    caches: any[];
    finds: any[];
    hides: any[];
    correctedCoordinates: any[];
    ownerFinderCountryStats: any[];
    statSnapshots: any[];
    mysteryWorkspaces: any[];
  };
};

function object(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an object`);
  }
  return value as Record<string, any>;
}

function records(value: unknown, label: string): any[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${label} must be an array`);
  }
  if (value.length > MAX_RECORDS) {
    throw new BadRequestException(`${label} contains too many records`);
  }
  return value.map((entry, index) => object(entry, `${label}[${index}]`));
}

function text(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return value;
}

function optionalText(
  value: unknown,
  label: string,
  max = 100_000,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max)
    throw new BadRequestException(`${label} is invalid`);
  return value;
}

function date(value: unknown, label: string): Date {
  const parsed = new Date(text(value, label, 100));
  if (Number.isNaN(parsed.getTime()))
    throw new BadRequestException(`${label} is not a valid date`);
  return parsed;
}

function decimal(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string | number {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !Number.isFinite(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, min = 0): number {
  if (!Number.isInteger(value) || Number(value) < min)
    throw new BadRequestException(`${label} is invalid`);
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new BadRequestException(`${label} is invalid`);
  return value;
}

function batches<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += WRITE_BATCH_SIZE)
    result.push(values.slice(index, index + WRITE_BATCH_SIZE));
  return result;
}

export function parsePortableArchive(input: Buffer | string): PortableArchive {
  let raw: unknown;
  try {
    raw = JSON.parse(
      typeof input === "string" ? input : input.toString("utf8"),
    );
  } catch {
    throw new BadRequestException("The selected file is not valid JSON");
  }
  const archive = object(raw, "archive");
  if (archive.format !== FORMAT)
    throw new BadRequestException(
      "This is not a Geostats portable data export",
    );
  if (archive.version !== VERSION)
    throw new BadRequestException(
      `Unsupported Geostats export version: ${String(archive.version)}`,
    );
  const data = object(archive.data, "data");
  const parsed = {
    ...archive,
    data: {
      profile:
        data.profile === null ? null : object(data.profile, "data.profile"),
      caches: records(data.caches, "data.caches"),
      finds: records(data.finds, "data.finds"),
      hides: records(data.hides, "data.hides"),
      correctedCoordinates: records(
        data.correctedCoordinates,
        "data.correctedCoordinates",
      ),
      ownerFinderCountryStats: records(
        data.ownerFinderCountryStats,
        "data.ownerFinderCountryStats",
      ),
      statSnapshots: records(data.statSnapshots, "data.statSnapshots"),
      mysteryWorkspaces: records(
        data.mysteryWorkspaces,
        "data.mysteryWorkspaces",
      ),
    },
  } as PortableArchive;
  if (parsed.data.mysteryWorkspaces.length > MAX_MYSTERY_WORKSPACES) {
    throw new BadRequestException(
      `data.mysteryWorkspaces cannot contain more than ${MAX_MYSTERY_WORKSPACES} records`,
    );
  }
  return parsed;
}

@Injectable()
export class PortabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PortabilityService.name);
  private importInProgress = false;
  private cleanupInProgress = false;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    void this.cleanupPendingObjects();
    this.cleanupTimer = setInterval(
      () => void this.cleanupPendingObjects(),
      OBJECT_CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async exportData(user: AuthUser): Promise<PortableArchive> {
    const [
      account,
      profile,
      finds,
      hides,
      corrections,
      ownerFinderCountryStats,
      statSnapshots,
      mysteryWorkspaces,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { username: true, email: true, createdAt: true },
      }),
      this.prisma.geocachingProfile.findUnique({ where: { userId: user.id } }),
      this.prisma.find.findMany({
        where: { userId: user.id },
        include: { cache: true },
        orderBy: [{ foundAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.hide.findMany({
        where: { userId: user.id },
        include: { cache: true },
        orderBy: [{ placedAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.correctedCoordinate.findMany({
        where: { userId: user.id },
        include: { cache: true },
        orderBy: { id: "asc" },
      }),
      this.prisma.ownerFinderCountryStat.findMany({
        where: { userId: user.id },
        orderBy: { country: "asc" },
      }),
      this.prisma.statSnapshot.findMany({
        where: { userId: user.id },
        orderBy: { generatedAt: "asc" },
      }),
      this.prisma.mysteryWorkspace.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const caches = new Map<string, any>();
    for (const row of [...finds, ...hides, ...corrections])
      caches.set(row.cache.gcCode, row.cache);
    const portableCache = (cache: any) => ({
      gcCode: cache.gcCode,
      name: cache.name,
      cacheType: cache.cacheType,
      difficulty: cache.difficulty,
      terrain: cache.terrain,
      size: cache.size,
      latitude: cache.latitude,
      longitude: cache.longitude,
      country: cache.country,
      region: cache.region,
      county: cache.county,
      hiddenDate: cache.hiddenDate,
      ownerName: cache.ownerName,
      raw: cache.raw,
    });

    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      account: {
        username: account.username,
        email: account.email,
        createdAt: account.createdAt.toISOString(),
      },
      data: {
        profile: profile && {
          gcUsername: profile.gcUsername,
          homeLatitude: profile.homeLatitude,
          homeLongitude: profile.homeLongitude,
          timeZone: profile.timeZone,
          ftfDetectionTerms: profile.ftfDetectionTerms,
        },
        caches: [...caches.values()]
          .sort((a, b) => a.gcCode.localeCompare(b.gcCode))
          .map(portableCache),
        finds: finds.map(({ cache, ...row }) => ({
          gcCode: cache.gcCode,
          foundAt: row.foundAt,
          logText: row.logText,
          isFtf: row.isFtf,
          isFtfManual: row.isFtfManual,
          importedFrom: row.importedFrom,
        })),
        hides: hides.map(({ cache, ...row }) => ({
          gcCode: cache.gcCode,
          placedAt: row.placedAt,
          receivedLogCount: row.receivedLogCount,
          receivedLogsRaw: row.receivedLogsRaw,
        })),
        correctedCoordinates: corrections.map(({ cache, ...row }) => ({
          gcCode: cache.gcCode,
          latitude: row.latitude,
          longitude: row.longitude,
          note: row.note,
        })),
        ownerFinderCountryStats: ownerFinderCountryStats.map((row) => ({
          country: row.country,
          count: row.count,
        })),
        statSnapshots: statSnapshots.map((row) => ({
          statsJson: row.statsJson,
          generatedAt: row.generatedAt,
        })),
        mysteryWorkspaces: mysteryWorkspaces.map((row) => ({
          clientId: row.clientId,
          gcCode: row.gcCode,
          data: row.data,
          snapshotRevision: row.snapshotRevision,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      },
    };
  }

  async deleteAccount(user: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const imports = await tx.import.findMany({
        where: { userId: user.id },
        select: { objectKey: true },
      });
      await tx.pendingObjectDeletion.createMany({
        data: imports.map(({ objectKey }) => ({ objectKey })),
        skipDuplicates: true,
      });
      await tx.user.delete({ where: { id: user.id } });
    });
    await this.cleanupPendingObjects();
  }

  async importFile(user: AuthUser, path: string, fileName = "geostats-export.json") {
    if (this.importInProgress) {
      throw new ServiceUnavailableException(
        "Another data import is already in progress; try again shortly",
      );
    }
    this.importInProgress = true;
    try {
      return await this.importData(user, await readFile(path, "utf8"), fileName);
    } finally {
      this.importInProgress = false;
    }
  }

  async importData(
    user: AuthUser,
    input: Buffer | string,
    fileName = "geostats-export.json",
  ) {
    const archive = parsePortableArchive(input);
    const data = archive.data;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (data.profile) {
            const profile = data.profile;
            const gcUsername = text(
              profile.gcUsername,
              "profile.gcUsername",
              60,
            );
            const timeZone = text(profile.timeZone, "profile.timeZone", 80);
            try {
              new Intl.DateTimeFormat("en-US", { timeZone }).format();
            } catch {
              throw new BadRequestException("profile.timeZone is invalid");
            }
            const terms = recordsAsStrings(
              profile.ftfDetectionTerms,
              "profile.ftfDetectionTerms",
              20,
              80,
            );
            const values = {
              gcUsername,
              homeLatitude:
                profile.homeLatitude == null
                  ? null
                  : decimal(
                      profile.homeLatitude,
                      "profile.homeLatitude",
                      -90,
                      90,
                    ),
              homeLongitude:
                profile.homeLongitude == null
                  ? null
                  : decimal(
                      profile.homeLongitude,
                      "profile.homeLongitude",
                      -180,
                      180,
                    ),
              timeZone,
              ftfDetectionTerms: terms,
            };
            await tx.geocachingProfile.upsert({
              where: { userId: user.id },
              create: { userId: user.id, ...values },
              update: values,
            });
          }

          const gcCodes = new Set<string>();
          const cacheRows = data.caches.map((cache, index) => {
            const label = `caches[${index}]`;
            const gcCode = text(
              cache.gcCode,
              `${label}.gcCode`,
              40,
            ).toUpperCase();
            if (gcCodes.has(gcCode))
              throw new BadRequestException(`Duplicate cache ${gcCode}`);
            gcCodes.add(gcCode);
            return {
              userId: user.id,
              gcCode,
              name: text(cache.name, `${label}.name`, 1000),
              cacheType: optionalText(
                cache.cacheType,
                `${label}.cacheType`,
                100,
              ),
              difficulty:
                cache.difficulty == null
                  ? null
                  : decimal(cache.difficulty, `${label}.difficulty`, 0, 10),
              terrain:
                cache.terrain == null
                  ? null
                  : decimal(cache.terrain, `${label}.terrain`, 0, 10),
              size: optionalText(cache.size, `${label}.size`, 100),
              latitude: decimal(cache.latitude, `${label}.latitude`, -90, 90),
              longitude: decimal(
                cache.longitude,
                `${label}.longitude`,
                -180,
                180,
              ),
              country: optionalText(cache.country, `${label}.country`, 200),
              region: optionalText(cache.region, `${label}.region`, 200),
              county: optionalText(cache.county, `${label}.county`, 200),
              hiddenDate:
                cache.hiddenDate == null
                  ? null
                  : date(cache.hiddenDate, `${label}.hiddenDate`),
              ownerName: optionalText(
                cache.ownerName,
                `${label}.ownerName`,
                500,
              ),
              ...(cache.raw == null
                ? {}
                : { raw: cache.raw as Prisma.InputJsonValue }),
            };
          });
          for (const batch of batches(cacheRows)) {
            await tx.cache.createMany({ data: batch, skipDuplicates: true });
          }
          const storedCaches = (
            await Promise.all(
              batches([...gcCodes]).map((batch) =>
                tx.cache.findMany({
                  where: { userId: user.id, gcCode: { in: batch } },
                  select: { id: true, gcCode: true },
                }),
              ),
            )
          ).flat();
          const cacheIds = new Map(
            storedCaches.map((cache) => [cache.gcCode, cache.id]),
          );
          const cacheId = (code: unknown, label: string) => {
            const gcCode = text(code, label, 40).toUpperCase();
            const id = cacheIds.get(gcCode);
            if (!id)
              throw new BadRequestException(
                `${label} refers to cache ${gcCode}, which is missing from the export`,
              );
            return id;
          };

          const finds = data.finds.map((row, index) => {
            const source = text(
              row.importedFrom,
              `finds[${index}].importedFrom`,
              40,
            );
            if (!IMPORT_SOURCES.has(source))
              throw new BadRequestException(
                `finds[${index}].importedFrom is invalid`,
              );
            return {
              userId: user.id,
              cacheId: cacheId(row.gcCode, `finds[${index}].gcCode`),
              foundAt: date(row.foundAt, `finds[${index}].foundAt`),
              logText: optionalText(row.logText, `finds[${index}].logText`),
              isFtf: boolean(row.isFtf, `finds[${index}].isFtf`),
              isFtfManual: boolean(
                row.isFtfManual,
                `finds[${index}].isFtfManual`,
              ),
              importedFrom: source as any,
            };
          });
          for (const batch of batches(finds)) {
            await tx.find.deleteMany({
              where: {
                userId: user.id,
                OR: batch.map((row) => ({
                  cacheId: row.cacheId,
                  foundAt: row.foundAt,
                })),
              },
            });
            await tx.find.createMany({ data: batch });
          }

          const hides = data.hides.map((row, index) => {
            const values = {
              placedAt:
                row.placedAt == null
                  ? null
                  : date(row.placedAt, `hides[${index}].placedAt`),
              receivedLogCount: integer(
                row.receivedLogCount,
                `hides[${index}].receivedLogCount`,
              ),
              ...(row.receivedLogsRaw == null
                ? { receivedLogsRaw: Prisma.JsonNull }
                : {
                    receivedLogsRaw:
                      row.receivedLogsRaw as Prisma.InputJsonValue,
                  }),
            };
            const key = {
              userId: user.id,
              cacheId: cacheId(row.gcCode, `hides[${index}].gcCode`),
            };
            return { ...key, ...values };
          });
          for (const batch of batches(hides)) {
            await tx.hide.deleteMany({
              where: {
                userId: user.id,
                cacheId: { in: batch.map((row) => row.cacheId) },
              },
            });
            await tx.hide.createMany({ data: batch });
          }
          const corrections = data.correctedCoordinates.map((row, index) => {
            const values = {
              latitude: decimal(
                row.latitude,
                `correctedCoordinates[${index}].latitude`,
                -90,
                90,
              ),
              longitude: decimal(
                row.longitude,
                `correctedCoordinates[${index}].longitude`,
                -180,
                180,
              ),
              note: optionalText(
                row.note,
                `correctedCoordinates[${index}].note`,
              ),
            };
            const key = {
              userId: user.id,
              cacheId: cacheId(
                row.gcCode,
                `correctedCoordinates[${index}].gcCode`,
              ),
            };
            return { ...key, ...values };
          });
          for (const batch of batches(corrections)) {
            await tx.correctedCoordinate.deleteMany({
              where: {
                userId: user.id,
                cacheId: { in: batch.map((row) => row.cacheId) },
              },
            });
            await tx.correctedCoordinate.createMany({ data: batch });
          }

          await tx.ownerFinderCountryStat.deleteMany({
            where: { userId: user.id },
          });
          const countryStats = data.ownerFinderCountryStats.map(
            (row, index) => ({
              userId: user.id,
              country: text(
                row.country,
                `ownerFinderCountryStats[${index}].country`,
                200,
              ),
              count: integer(
                row.count,
                `ownerFinderCountryStats[${index}].count`,
              ),
            }),
          );
          for (const batch of batches(countryStats)) {
            await tx.ownerFinderCountryStat.createMany({ data: batch });
          }
          await tx.statSnapshot.deleteMany({ where: { userId: user.id } });
          const snapshots = data.statSnapshots.map((row, index) => ({
            userId: user.id,
            statsJson: object(
              row.statsJson,
              `statSnapshots[${index}].statsJson`,
            ) as Prisma.InputJsonValue,
            generatedAt: date(
              row.generatedAt,
              `statSnapshots[${index}].generatedAt`,
            ),
          }));
          for (const batch of batches(snapshots)) {
            await tx.statSnapshot.createMany({ data: batch });
          }

          const mysteryClientIds: string[] = [];
          for (const [index, row] of data.mysteryWorkspaces.entries()) {
            const clientId = text(
              row.clientId,
              `mysteryWorkspaces[${index}].clientId`,
              200,
            );
            const mystery = object(
              row.data,
              `mysteryWorkspaces[${index}].data`,
            );
            const gcCode = text(
              row.gcCode ?? mystery.gcCode,
              `mysteryWorkspaces[${index}].gcCode`,
              40,
            ).toUpperCase();
            const normalizedMystery = { ...mystery, gcCode };
            if (
              mystery.id !== clientId ||
              !/^GC[A-Z0-9]+$/.test(gcCode) ||
              Buffer.byteLength(JSON.stringify(normalizedMystery), "utf8") >
                MAX_MYSTERY_BYTES
            ) {
              throw new BadRequestException(
                `mysteryWorkspaces[${index}].data does not match its workspace`,
              );
            }
            mysteryClientIds.push(clientId);
            const values = {
              gcCode,
              data: normalizedMystery as Prisma.InputJsonValue,
              snapshotRevision: integer(
                row.snapshotRevision,
                `mysteryWorkspaces[${index}].snapshotRevision`,
              ),
            };
            await tx.mysteryWorkspace.upsert({
              where: { ownerId_clientId: { ownerId: user.id, clientId } },
              create: { ownerId: user.id, clientId, ...values },
              update: values,
            });
          }
          for (const batch of batches(mysteryClientIds)) {
            await tx.mysteryWorkspaceDeletion.deleteMany({
              where: { ownerId: user.id, clientId: { in: batch } },
            });
          }
          await tx.import.create({
            data: {
              userId: user.id,
              fileName: fileName.trim().slice(0, 255) || "geostats-export.json",
              fileType: ImportFileType.JSON,
              source: ImportSource.GEOSTATS_EXPORT,
              status: ImportStatus.COMPLETED,
              objectKey: `portability-history/${user.id}/${randomUUID()}`,
            },
          });
          return {
            imported: {
              caches: cacheRows.length,
              finds: finds.length,
              hides: hides.length,
              correctedCoordinates: corrections.length,
              mysteryWorkspaces: data.mysteryWorkspaces.length,
            },
          };
        },
        { maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        "The export could not be imported. It may contain invalid or conflicting data.",
      );
    }
  }

  private async cleanupPendingObjects() {
    if (this.cleanupInProgress) return;
    this.cleanupInProgress = true;
    try {
      const pending = await this.prisma.pendingObjectDeletion.findMany({
        orderBy: { createdAt: "asc" },
        take: OBJECT_CLEANUP_BATCH_SIZE,
      });
      for (const item of pending) {
        try {
          await this.storage.deleteObject(item.objectKey);
          await this.prisma.pendingObjectDeletion.deleteMany({
            where: { objectKey: item.objectKey },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown storage error";
          await this.prisma.pendingObjectDeletion
            .update({
              where: { objectKey: item.objectKey },
              data: {
                attempts: { increment: 1 },
                lastError: message.slice(0, 2_000),
              },
            })
            .catch(() => undefined);
          this.logger.warn(
            `Object deletion for ${item.objectKey} will be retried: ${message}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Pending object cleanup could not run: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.cleanupInProgress = false;
    }
  }
}

function recordsAsStrings(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || item.length > maxLength)
  ) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return value;
}
