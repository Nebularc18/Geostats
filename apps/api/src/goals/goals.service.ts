import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { PrismaService } from "../common/prisma.service";
import { StatsService } from "../stats/stats.service";

export const GOAL_KINDS = [
  "YEARLY_FINDS",
  "TOTAL_FINDS",
  "DT_GRID",
  "JASMER",
  "CALENDAR_366",
  "STREAK",
  "COUNTRIES",
  "REGIONS",
  "COUNTIES",
  "CACHE_TYPE",
  "CUSTOM"
] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

export interface GoalConfig {
  year?: number;
  cacheType?: string;
  country?: string;
  manualCurrent?: number;
  note?: string;
}

export interface GoalInput {
  title: string;
  kind: GoalKind;
  target: number;
  config?: GoalConfig;
  archived?: boolean;
}

export interface EnrichedGoal {
  id: string;
  title: string;
  kind: GoalKind;
  target: number;
  current: number;
  remaining: number;
  percent: number;
  completed: boolean;
  archived: boolean;
  config: GoalConfig;
  gapFilter: "missing_dt" | "missing_jasmer" | "missing_county" | null;
  createdAt: string;
  updatedAt: string;
}

function isGoalKind(value: unknown): value is GoalKind {
  return typeof value === "string" && (GOAL_KINDS as readonly string[]).includes(value);
}

function parseConfig(value: unknown): GoalConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const config: GoalConfig = {};
  if (typeof raw.year === "number" && Number.isInteger(raw.year) && raw.year >= 2000 && raw.year <= 2100) {
    config.year = raw.year;
  }
  if (typeof raw.cacheType === "string" && raw.cacheType.trim()) {
    config.cacheType = raw.cacheType.trim().slice(0, 80);
  }
  if (typeof raw.country === "string" && raw.country.trim()) {
    config.country = raw.country.trim().slice(0, 80);
  }
  if (typeof raw.manualCurrent === "number" && Number.isFinite(raw.manualCurrent) && raw.manualCurrent >= 0) {
    config.manualCurrent = Math.floor(raw.manualCurrent);
  }
  if (typeof raw.note === "string" && raw.note.trim()) {
    config.note = raw.note.trim().slice(0, 240);
  }
  return config;
}

export function evaluateGoalCurrent(kind: GoalKind, config: GoalConfig, stats: any): number {
  switch (kind) {
    case "YEARLY_FINDS": {
      const year = String(config.year ?? new Date().getUTCFullYear());
      const bucket = Array.isArray(stats?.findsByYear)
        ? stats.findsByYear.find((entry: any) => String(entry?.key) === year)
        : null;
      return Number(bucket?.count ?? 0);
    }
    case "TOTAL_FINDS":
      return Number(stats?.totalFinds ?? 0);
    case "DT_GRID":
      return Array.isArray(stats?.difficultyTerrain)
        ? stats.difficultyTerrain.filter((cell: any) => Number(cell?.count ?? 0) > 0).length
        : 0;
    case "JASMER":
      return Array.isArray(stats?.hiddenMonthMatrix)
        ? stats.hiddenMonthMatrix.filter((entry: any) => Number(entry?.count ?? 0) > 0).length
        : 0;
    case "CALENDAR_366":
      return Array.isArray(stats?.foundDateMatrix)
        ? stats.foundDateMatrix.filter((entry: any) => Number(entry?.count ?? 0) > 0).length
        : 0;
    case "STREAK":
      return Math.max(Number(stats?.streaks?.longest ?? 0), Number(stats?.streaks?.current ?? 0));
    case "COUNTRIES":
      return Array.isArray(stats?.countries)
        ? stats.countries.filter(isKnownLocation).length
        : 0;
    case "REGIONS":
      return Array.isArray(stats?.regions)
        ? stats.regions.filter(isKnownLocation).length
        : 0;
    case "COUNTIES":
      return Array.isArray(stats?.counties)
        ? stats.counties.filter(isKnownLocation).length
        : 0;
    case "CACHE_TYPE": {
      const targetType = (config.cacheType ?? "").trim().toLowerCase();
      if (!targetType || !Array.isArray(stats?.cacheTypes)) return 0;
      const bucket = stats.cacheTypes.find(
        (entry: any) => typeof entry?.key === "string" && entry.key.trim().toLowerCase() === targetType
      );
      return Number(bucket?.count ?? 0);
    }
    case "CUSTOM":
      return Number(config.manualCurrent ?? 0);
  }
}

function isKnownLocation(entry: { key?: string; count?: number } | null) {
  const key = entry?.key?.trim().toLowerCase();
  return Boolean(key && key !== "unknown" && Number(entry?.count ?? 0) > 0);
}

function gapFilterForKind(kind: GoalKind): EnrichedGoal["gapFilter"] {
  if (kind === "DT_GRID") return "missing_dt";
  if (kind === "JASMER") return "missing_jasmer";
  if (kind === "COUNTIES") return "missing_county";
  return null;
}

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService
  ) {}

  private enrich(record: {
    id: string;
    title: string;
    kind: string;
    target: number;
    config: Prisma.JsonValue | null;
    archived: boolean;
    createdAt: Date;
    updatedAt: Date;
  }, stats: any): EnrichedGoal {
    const kind: GoalKind = isGoalKind(record.kind) ? record.kind : "CUSTOM";
    const config = parseConfig(record.config);
    const target = Math.max(1, record.target);
    const current = Math.max(0, evaluateGoalCurrent(kind, config, stats));
    const remaining = Math.max(0, target - current);
    const percent = Math.min(100, Math.round((current / target) * 100));
    return {
      id: record.id,
      title: record.title,
      kind,
      target,
      current,
      remaining,
      percent,
      completed: current >= target,
      archived: record.archived,
      config,
      gapFilter: gapFilterForKind(kind),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    };
  }

  async list(userId: string) {
    const [records, stats] = await Promise.all([
      this.prisma.personalGoal.findMany({
        where: { userId },
        orderBy: [{ archived: "asc" }, { createdAt: "asc" }]
      }),
      this.stats.snapshotForUser(userId)
    ]);

    const goals = records.map((record) => this.enrich(record, stats));
    return {
      goals,
      cacheTypes: Array.isArray((stats as any)?.cacheTypes)
        ? (stats as any).cacheTypes.map((entry: any) => String(entry.key)).filter(Boolean)
        : []
    };
  }

  async create(userId: string, body: Partial<GoalInput>) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 140) {
      throw new BadRequestException("Title must be between 1 and 140 characters");
    }
    if (!isGoalKind(body.kind)) {
      throw new BadRequestException("Unsupported goal kind");
    }
    const target = Number(body.target);
    if (!Number.isInteger(target) || target < 1 || target > 1_000_000) {
      throw new BadRequestException("Target must be a positive integer");
    }
    const config = parseConfig(body.config);

    const existingCount = await this.prisma.personalGoal.count({ where: { userId } });
    if (existingCount >= 100) {
      throw new BadRequestException("Goal limit reached (100 goals per account)");
    }

    const created = await this.prisma.personalGoal.create({
      data: {
        userId,
        title,
        kind: body.kind,
        target,
        config: config as Prisma.InputJsonValue
      }
    });
    const stats = await this.stats.snapshotForUser(userId);
    return { goal: this.enrich(created, stats) };
  }

  async update(userId: string, id: string, body: Partial<GoalInput>) {
    const existing = await this.prisma.personalGoal.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException("Goal not found");
    }

    const data: Prisma.PersonalGoalUpdateInput = {};
    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title || title.length > 140) {
        throw new BadRequestException("Title must be between 1 and 140 characters");
      }
      data.title = title;
    }
    if (body.kind !== undefined) {
      if (!isGoalKind(body.kind)) {
        throw new BadRequestException("Unsupported goal kind");
      }
      data.kind = body.kind;
    }
    if (body.target !== undefined) {
      const target = Number(body.target);
      if (!Number.isInteger(target) || target < 1 || target > 1_000_000) {
        throw new BadRequestException("Target must be a positive integer");
      }
      data.target = target;
    }
    if (body.config !== undefined) {
      data.config = parseConfig(body.config) as Prisma.InputJsonValue;
    }
    if (typeof body.archived === "boolean") {
      data.archived = body.archived;
    }

    const updated = await this.prisma.personalGoal.update({
      where: { id: existing.id },
      data
    });
    const stats = await this.stats.snapshotForUser(userId);
    return { goal: this.enrich(updated, stats) };
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.personalGoal.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException("Goal not found");
    }
    await this.prisma.personalGoal.delete({ where: { id: existing.id } });
    return { deleted: true, id: existing.id };
  }
}
