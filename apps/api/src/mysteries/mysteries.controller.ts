import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

type ShareMysteryBody = {
  recipientId?: unknown;
  mystery?: unknown;
  revision?: unknown;
};

type UpdateMysteryBody = {
  mystery?: unknown;
  revision?: unknown;
};

type SharingPreferenceBody = {
  statuses?: unknown;
};

const MYSTERY_STATUSES = ["solving", "solved", "planned"] as const;
type MysteryStatus = typeof MYSTERY_STATUSES[number];

const MAX_MYSTERY_NAME_LENGTH = 300;
const MAX_MYSTERY_SNAPSHOT_BYTES = 256 * 1024;
const MAX_MYSTERY_WORKSPACES_PER_OWNER = 500;

function mysteryData(value: unknown, clientId: string): { data: Prisma.InputJsonValue; gcCode: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Mystery data is required");
  }
  const mystery = value as Record<string, unknown>;
  const gcCode = typeof mystery.gcCode === "string" ? mystery.gcCode.trim().toUpperCase() : "";
  const name = typeof mystery.name === "string" ? mystery.name.trim() : "";
  if (mystery.id !== clientId || !/^GC[A-Z0-9]+$/.test(gcCode) || !name) {
    throw new BadRequestException("Mystery data does not match the requested mystery");
  }
  if (name.length > MAX_MYSTERY_NAME_LENGTH) {
    throw new BadRequestException(`Mystery names cannot exceed ${MAX_MYSTERY_NAME_LENGTH} characters`);
  }
  const normalized = { ...mystery, gcCode, name } as Prisma.InputJsonObject;
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_MYSTERY_SNAPSHOT_BYTES) {
    throw new BadRequestException("Mystery data is too large to share");
  }
  return { data: normalized, gcCode };
}

function snapshotRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new BadRequestException("A positive snapshot revision is required");
  }
  return value as number;
}

function sharingStatuses(value: unknown): MysteryStatus[] {
  if (!Array.isArray(value)) throw new BadRequestException("Choose at least one Mystery status");
  const statuses = [...new Set(value)];
  if (!statuses.length || statuses.some((status) => !MYSTERY_STATUSES.includes(status as MysteryStatus))) {
    throw new BadRequestException("Choose one or more valid Mystery statuses");
  }
  return MYSTERY_STATUSES.filter((status) => statuses.includes(status));
}

function mysteryStatus(value: Prisma.JsonValue): MysteryStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = (value as Prisma.JsonObject).status;
  return MYSTERY_STATUSES.includes(status as MysteryStatus) ? status as MysteryStatus : null;
}

function effectiveRecipients(
  data: Prisma.JsonValue,
  explicit: Array<{ id: string; username: string }>,
  preferences: Array<{ statuses: string[]; recipient: { id: string; username: string } }>,
  excludedRecipientIds: string[] = []
) {
  const status = mysteryStatus(data);
  const excluded = new Set(excludedRecipientIds);
  const recipients = new Map(explicit.map((recipient) => [recipient.id, recipient]));
  if (status) {
    preferences.forEach((preference) => {
      if (preference.statuses.includes(status) && !excluded.has(preference.recipient.id)) {
        recipients.set(preference.recipient.id, preference.recipient);
      }
    });
  }
  return [...recipients.values()];
}

export async function lockMystery(tx: Prisma.TransactionClient, ownerId: string, ...keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${key}))::text AS lock_result
    `;
  }
}

@Controller("mysteries")
@UseGuards(AuthGuard)
export class MysteriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("owned")
  async owned(@CurrentUser() user: AuthUser) {
    const [mysteries, deletions, preferences] = await Promise.all([
      this.prisma.mysteryWorkspace.findMany({
        where: { ownerId: user.id },
        select: {
          clientId: true,
          data: true,
          snapshotRevision: true,
          shares: {
            select: { recipient: { select: { id: true, username: true } } },
            orderBy: { createdAt: "asc" }
          },
          sharingExclusions: { select: { recipientId: true } }
        },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.mysteryWorkspaceDeletion.findMany({
        where: { ownerId: user.id },
        select: { clientId: true }
      }),
      this.prisma.mysterySharingPreference.findMany({
        where: { ownerId: user.id },
        select: {
          statuses: true,
          recipient: { select: { id: true, username: true } }
        },
        orderBy: { createdAt: "asc" }
      })
    ]);
    return {
      mysteries: mysteries.map((mystery) => ({
        clientId: mystery.clientId,
        mystery: mystery.data,
        revision: mystery.snapshotRevision,
        sharedWith: effectiveRecipients(
          mystery.data,
          mystery.shares.map(({ recipient }) => recipient),
          preferences,
          mystery.sharingExclusions.map(({ recipientId }) => recipientId)
        )
      })),
      deletedClientIds: deletions.map(({ clientId }) => clientId)
    };
  }

  @Get("owned-shares")
  async ownedShares(@CurrentUser() user: AuthUser) {
    const [mysteries, deletions, preferences] = await Promise.all([
      this.prisma.mysteryWorkspace.findMany({
        where: { ownerId: user.id },
        select: {
          clientId: true,
          data: true,
          snapshotRevision: true,
          shares: {
            select: { recipient: { select: { id: true, username: true } } },
            orderBy: { createdAt: "asc" }
          },
          sharingExclusions: { select: { recipientId: true } }
        }
      }),
      this.prisma.mysteryWorkspaceDeletion.findMany({
        where: { ownerId: user.id },
        select: { clientId: true }
      }),
      this.prisma.mysterySharingPreference.findMany({
        where: { ownerId: user.id },
        select: {
          statuses: true,
          recipient: { select: { id: true, username: true } }
        },
        orderBy: { createdAt: "asc" }
      })
    ]);
    return {
      mysteries: mysteries.flatMap((mystery) => {
        const sharedWith = effectiveRecipients(
          mystery.data,
          mystery.shares.map(({ recipient }) => recipient),
          preferences,
          mystery.sharingExclusions.map(({ recipientId }) => recipientId)
        );
        return sharedWith.length ? [{ clientId: mystery.clientId, revision: mystery.snapshotRevision, sharedWith }] : [];
      }),
      deletedClientIds: deletions.map(({ clientId }) => clientId)
    };
  }

  @Get("shared")
  async shared(@CurrentUser() user: AuthUser) {
    const [grants, receivedPreferences] = await Promise.all([this.prisma.mysteryShare.findMany({
      where: { recipientId: user.id },
      include: {
        mystery: {
          include: {
            owner: { select: { id: true, username: true } },
            shares: {
              include: { recipient: { select: { id: true, username: true } } },
              orderBy: { createdAt: "asc" }
            },
            sharingExclusions: { select: { recipientId: true } }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    }), this.prisma.mysterySharingPreference.findMany({
      where: { recipientId: user.id },
      select: { ownerId: true }
    })]);

    const preferenceOwnerIds = [...new Set(receivedPreferences.map(({ ownerId }) => ownerId))];
    const preferenceMysteries = preferenceOwnerIds.length ? await this.prisma.mysteryWorkspace.findMany({
      where: { ownerId: { in: preferenceOwnerIds } },
      include: {
        owner: { select: { id: true, username: true } },
        shares: {
          include: { recipient: { select: { id: true, username: true } } },
          orderBy: { createdAt: "asc" }
        },
        sharingExclusions: { select: { recipientId: true } }
      },
      orderBy: { createdAt: "asc" }
    }) : [];
    const ownerIds = [...new Set([...grants.map(({ mystery }) => mystery.owner.id), ...preferenceOwnerIds])];
    const allPreferences = ownerIds.length ? await this.prisma.mysterySharingPreference.findMany({
      where: { ownerId: { in: ownerIds } },
      select: {
        ownerId: true,
        statuses: true,
        recipient: { select: { id: true, username: true } }
      },
      orderBy: { createdAt: "asc" }
    }) : [];
    const workspaces = new Map<string, (typeof preferenceMysteries)[number]>();
    grants.forEach(({ mystery }) => workspaces.set(mystery.id, mystery));
    preferenceMysteries.forEach((mystery) => {
      const status = mysteryStatus(mystery.data);
      const visible = status && allPreferences.some((preference) =>
        preference.ownerId === mystery.owner.id &&
        preference.recipient.id === user.id &&
        preference.statuses.includes(status) &&
        !mystery.sharingExclusions.some(({ recipientId }) => recipientId === user.id)
      );
      if (visible) workspaces.set(mystery.id, mystery);
    });

    return {
      mysteries: [...workspaces.values()].map((mystery) => ({
        workspaceId: mystery.id,
        mystery: mystery.data,
        owner: mystery.owner,
        sharedWith: effectiveRecipients(
          mystery.data,
          mystery.shares.map(({ recipient }) => recipient),
          allPreferences.filter((preference) => preference.ownerId === mystery.owner.id),
          mystery.sharingExclusions.map(({ recipientId }) => recipientId)
        )
      }))
    };
  }

  @Get("sharing-preferences")
  async sharingPreferences(@CurrentUser() user: AuthUser) {
    const preferences = await this.prisma.mysterySharingPreference.findMany({
      where: { ownerId: user.id },
      select: {
        statuses: true,
        recipient: { select: { id: true, username: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    return { preferences };
  }

  @Put("sharing-preferences/:recipientId")
  async setSharingPreference(
    @CurrentUser() user: AuthUser,
    @Param("recipientId") recipientId: string,
    @Body() body: SharingPreferenceBody
  ) {
    if (!recipientId || recipientId === user.id) throw new BadRequestException("Choose another registered user");
    const statuses = sharingStatuses(body.statuses);
    const recipient = await this.prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, username: true }
    });
    if (!recipient) throw new NotFoundException("Recipient was not found");
    const preference = await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, user.id, `sharing-preference:${recipientId}`);
      const existing = await tx.mysterySharingPreference.findUnique({
        where: { ownerId_recipientId: { ownerId: user.id, recipientId } },
        select: { id: true }
      });
      const stored = await tx.mysterySharingPreference.upsert({
        where: { ownerId_recipientId: { ownerId: user.id, recipientId } },
        create: { ownerId: user.id, recipientId, statuses },
        update: { statuses },
        select: { statuses: true }
      });
      if (!existing) {
        await tx.mysterySharingExclusion.deleteMany({
          where: { recipientId, mystery: { ownerId: user.id } }
        });
      }
      return stored;
    });
    return { preference: { recipient, statuses: preference.statuses } };
  }

  @Delete("sharing-preferences/:recipientId")
  async deleteSharingPreference(@CurrentUser() user: AuthUser, @Param("recipientId") recipientId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, user.id, `sharing-preference:${recipientId}`);
      await tx.mysterySharingPreference.deleteMany({ where: { ownerId: user.id, recipientId } });
    });
    return { ok: true };
  }

  @Post(":clientId/shares")
  async share(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: ShareMysteryBody
  ) {
    if (typeof body.recipientId !== "string" || body.recipientId === user.id) {
      throw new BadRequestException("Choose another registered user");
    }
    const { data, gcCode } = mysteryData(body.mystery, clientId);
    const revision = snapshotRevision(body.revision);

    const recipient = await this.prisma.user.findUnique({
      where: { id: body.recipientId },
      select: { id: true, username: true }
    });
    if (!recipient) throw new NotFoundException("Recipient was not found");

    const storedRevision = await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, user.id, clientId, gcCode);
      const deletion = await tx.mysteryWorkspaceDeletion.findUnique({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        select: { id: true }
      });
      if (deletion) throw new NotFoundException("Mystery was deleted");

      const duplicate = await tx.mysteryWorkspace.findUnique({
        where: { ownerId_gcCode: { ownerId: user.id, gcCode } },
        select: { clientId: true }
      });
      if (duplicate && duplicate.clientId !== clientId) {
        throw new ConflictException(`${gcCode} already has a shared workspace`);
      }

      const existing = duplicate ?? await tx.mysteryWorkspace.findUnique({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        select: { clientId: true }
      });
      if (!existing) {
        const workspaceCount = await tx.mysteryWorkspace.count({ where: { ownerId: user.id } });
        if (workspaceCount >= MAX_MYSTERY_WORKSPACES_PER_OWNER) {
          throw new BadRequestException("Too many shared Mystery workspaces");
        }
      }
      const mystery = await tx.mysteryWorkspace.upsert({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        create: { ownerId: user.id, clientId, gcCode, data, snapshotRevision: revision },
        update: {}
      });
      await tx.mysteryWorkspace.updateMany({
        where: { id: mystery.id, snapshotRevision: { lt: revision } },
        data: { data, snapshotRevision: revision }
      });
      await tx.mysteryShare.upsert({
        where: { mysteryId_recipientId: { mysteryId: mystery.id, recipientId: recipient.id } },
        create: { mysteryId: mystery.id, recipientId: recipient.id },
        update: {}
      });
      await tx.mysterySharingExclusion.deleteMany({
        where: { mysteryId: mystery.id, recipientId: recipient.id }
      });
      const stored = await tx.mysteryWorkspace.findUnique({
        where: { id: mystery.id },
        select: { snapshotRevision: true }
      });
      return stored?.snapshotRevision ?? revision;
    });

    return { recipient, revision: storedRevision };
  }

  @Put(":clientId")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: UpdateMysteryBody
  ) {
    const { data, gcCode } = mysteryData(body.mystery, clientId);
    const revision = snapshotRevision(body.revision);
    const storedRevision = await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, user.id, clientId, gcCode);
      const deletion = await tx.mysteryWorkspaceDeletion.findUnique({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        select: { id: true }
      });
      if (deletion) throw new NotFoundException("Mystery was deleted");

      const duplicate = await tx.mysteryWorkspace.findUnique({
        where: { ownerId_gcCode: { ownerId: user.id, gcCode } },
        select: { clientId: true }
      });
      if (duplicate && duplicate.clientId !== clientId) {
        throw new ConflictException(`${gcCode} already has a workspace`);
      }

      const existing = duplicate ?? await tx.mysteryWorkspace.findUnique({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        select: { clientId: true }
      });
      if (!existing) {
        const workspaceCount = await tx.mysteryWorkspace.count({ where: { ownerId: user.id } });
        if (workspaceCount >= MAX_MYSTERY_WORKSPACES_PER_OWNER) {
          throw new BadRequestException("Too many Mystery workspaces");
        }
      }

      const mystery = await tx.mysteryWorkspace.upsert({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        create: { ownerId: user.id, clientId, gcCode, data, snapshotRevision: revision },
        update: {},
        select: { id: true }
      });
      // Let PostgreSQL compare and conditionally update the JSONB value in one
      // statement. Keeping the equality check in the UPDATE predicate makes it
      // impossible for an identical browser snapshot to advance the revision,
      // even when several sync requests race each other.
      const [stored] = await tx.$queryRaw<Array<{
        revision: number;
        mystery: Prisma.JsonValue;
        content_matches: boolean;
      }>>`
        WITH requested AS (
          SELECT ${JSON.stringify(data)}::jsonb AS data
        ), updated AS (
          UPDATE mystery_workspaces AS workspace
          SET data = requested.data,
              snapshot_revision = ${revision},
              updated_at = CURRENT_TIMESTAMP
          FROM requested
          WHERE workspace.id = ${mystery.id}
            AND workspace.snapshot_revision < ${revision}
            AND workspace.data IS DISTINCT FROM requested.data
          RETURNING workspace.snapshot_revision AS revision,
                    workspace.data AS mystery
        )
        SELECT updated.revision,
               updated.mystery,
               TRUE AS content_matches
        FROM updated
        UNION ALL
        SELECT workspace.snapshot_revision,
               workspace.data,
               workspace.data = requested.data
        FROM mystery_workspaces AS workspace
        CROSS JOIN requested
        WHERE workspace.id = ${mystery.id}
          AND NOT EXISTS (SELECT 1 FROM updated)
      `;
      return {
        revision: stored?.revision ?? revision,
        // Echo an equivalent submitted representation. This lets the browser
        // remember exactly what it sent instead of interpreting a JSONB
        // readback representation difference as another server edit.
        mystery: stored?.content_matches ? data : stored?.mystery ?? data
      };
    });
    return { ok: true, ...storedRevision };
  }

  @Delete(":clientId")
  async delete(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, user.id, clientId);
      await tx.mysteryWorkspace.deleteMany({
        where: { ownerId: user.id, clientId }
      });
      await tx.mysteryWorkspaceDeletion.upsert({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        create: { ownerId: user.id, clientId },
        update: { deletedAt: new Date() }
      });
    });
    return { ok: true };
  }

  @Delete(":clientId/shares/:recipientId")
  async unshare(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("recipientId") recipientId: string
  ) {
    await this.prisma.$transaction(async (tx) => {
      await lockMystery(tx, user.id, clientId, `sharing-preference:${recipientId}`);
      const mystery = await tx.mysteryWorkspace.findUnique({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        select: { id: true, data: true }
      });
      if (!mystery) throw new NotFoundException("Shared mystery was not found");
      await tx.mysteryShare.deleteMany({ where: { mysteryId: mystery.id, recipientId } });
      const status = mysteryStatus(mystery.data);
      const preference = status ? await tx.mysterySharingPreference.findUnique({
        where: { ownerId_recipientId: { ownerId: user.id, recipientId } },
        select: { statuses: true }
      }) : null;
      if (status && preference?.statuses.includes(status)) {
        await tx.mysterySharingExclusion.upsert({
          where: { mysteryId_recipientId: { mysteryId: mystery.id, recipientId } },
          create: { mysteryId: mystery.id, recipientId },
          update: {}
        });
      }
    });
    return { ok: true };
  }
}
