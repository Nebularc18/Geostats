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

async function lockMystery(tx: Prisma.TransactionClient, ownerId: string, key: string) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${key}))::text AS lock_result
  `;
}

@Controller("mysteries")
@UseGuards(AuthGuard)
export class MysteriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("owned")
  async owned(@CurrentUser() user: AuthUser) {
    const [mysteries, deletions] = await Promise.all([
      this.prisma.mysteryWorkspace.findMany({
        where: { ownerId: user.id },
        select: {
          clientId: true,
          data: true,
          snapshotRevision: true,
          shares: {
            select: { recipient: { select: { id: true, username: true } } },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.mysteryWorkspaceDeletion.findMany({
        where: { ownerId: user.id },
        select: { clientId: true }
      })
    ]);
    return {
      mysteries: mysteries.map((mystery) => ({
        clientId: mystery.clientId,
        mystery: mystery.data,
        revision: mystery.snapshotRevision,
        sharedWith: mystery.shares.map(({ recipient }) => recipient)
      })),
      deletedClientIds: deletions.map(({ clientId }) => clientId)
    };
  }

  @Get("owned-shares")
  async ownedShares(@CurrentUser() user: AuthUser) {
    const [mysteries, deletions] = await Promise.all([
      this.prisma.mysteryWorkspace.findMany({
        where: { ownerId: user.id, shares: { some: {} } },
        select: {
          clientId: true,
          snapshotRevision: true,
          shares: {
            select: { recipient: { select: { id: true, username: true } } },
            orderBy: { createdAt: "asc" }
          }
        }
      }),
      this.prisma.mysteryWorkspaceDeletion.findMany({
        where: { ownerId: user.id },
        select: { clientId: true }
      })
    ]);
    return {
      mysteries: mysteries.map((mystery) => ({
        clientId: mystery.clientId,
        revision: mystery.snapshotRevision,
        sharedWith: mystery.shares.map(({ recipient }) => recipient)
      })),
      deletedClientIds: deletions.map(({ clientId }) => clientId)
    };
  }

  @Get("shared")
  async shared(@CurrentUser() user: AuthUser) {
    const grants = await this.prisma.mysteryShare.findMany({
      where: { recipientId: user.id },
      include: {
        mystery: {
          include: {
            owner: { select: { id: true, username: true } },
            shares: {
              include: { recipient: { select: { id: true, username: true } } },
              orderBy: { createdAt: "asc" }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return {
      mysteries: grants.map(({ mystery }) => ({
        workspaceId: mystery.id,
        mystery: mystery.data,
        owner: mystery.owner,
        sharedWith: mystery.shares.map(({ recipient }) => recipient)
      }))
    };
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
      await lockMystery(tx, user.id, gcCode);
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
      await lockMystery(tx, user.id, gcCode);
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
        update: {}
      });
      await tx.mysteryWorkspace.updateMany({
        where: { id: mystery.id, snapshotRevision: { lt: revision } },
        data: { data, snapshotRevision: revision }
      });
      const stored = await tx.mysteryWorkspace.findUnique({
        where: { id: mystery.id },
        select: { snapshotRevision: true, data: true }
      });
      return {
        revision: stored?.snapshotRevision ?? revision,
        mystery: stored?.data ?? data
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
      await lockMystery(tx, user.id, clientId);
      const mystery = await tx.mysteryWorkspace.findUnique({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        select: { id: true }
      });
      if (!mystery) throw new NotFoundException("Shared mystery was not found");
      await tx.mysteryShare.deleteMany({ where: { mysteryId: mystery.id, recipientId } });
    });
    return { ok: true };
  }
}
