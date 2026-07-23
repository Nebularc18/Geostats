import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

type ShareMysteryBody = {
  recipientId?: unknown;
  mystery?: unknown;
};

type UpdateMysteryBody = {
  mystery?: unknown;
};

function mysteryData(value: unknown, clientId: string): Prisma.InputJsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Mystery data is required");
  }
  const mystery = value as Record<string, unknown>;
  if (mystery.id !== clientId || typeof mystery.gcCode !== "string" || typeof mystery.name !== "string") {
    throw new BadRequestException("Mystery data does not match the requested mystery");
  }
  return mystery as Prisma.InputJsonObject;
}

@Controller("mysteries")
@UseGuards(AuthGuard)
export class MysteriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("owned-shares")
  async ownedShares(@CurrentUser() user: AuthUser) {
    const mysteries = await this.prisma.mysteryWorkspace.findMany({
      where: { ownerId: user.id, shares: { some: {} } },
      select: {
        clientId: true,
        shares: {
          select: { recipient: { select: { id: true, username: true } } },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    return {
      mysteries: mysteries.map((mystery) => ({
        clientId: mystery.clientId,
        sharedWith: mystery.shares.map(({ recipient }) => recipient)
      }))
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
    const data = mysteryData(body.mystery, clientId);

    const recipient = await this.prisma.user.findUnique({
      where: { id: body.recipientId },
      select: { id: true, username: true }
    });
    if (!recipient) throw new NotFoundException("Recipient was not found");

    await this.prisma.$transaction(async (tx) => {
      const mystery = await tx.mysteryWorkspace.upsert({
        where: { ownerId_clientId: { ownerId: user.id, clientId } },
        create: { ownerId: user.id, clientId, data },
        update: { data }
      });
      await tx.mysteryShare.upsert({
        where: { mysteryId_recipientId: { mysteryId: mystery.id, recipientId: recipient.id } },
        create: { mysteryId: mystery.id, recipientId: recipient.id },
        update: {}
      });
    });

    return { recipient };
  }

  @Put(":clientId")
  async update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: UpdateMysteryBody
  ) {
    const data = mysteryData(body.mystery, clientId);
    const result = await this.prisma.mysteryWorkspace.updateMany({
      where: { ownerId: user.id, clientId },
      data: { data }
    });
    if (result.count === 0) throw new NotFoundException("Shared mystery was not found");
    return { ok: true };
  }

  @Delete(":clientId")
  async delete(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    await this.prisma.mysteryWorkspace.deleteMany({
      where: { ownerId: user.id, clientId }
    });
    return { ok: true };
  }

  @Delete(":clientId/shares/:recipientId")
  async unshare(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Param("recipientId") recipientId: string
  ) {
    const mystery = await this.prisma.mysteryWorkspace.findUnique({
      where: { ownerId_clientId: { ownerId: user.id, clientId } },
      select: { id: true }
    });
    if (!mystery) throw new NotFoundException("Shared mystery was not found");
    await this.prisma.mysteryShare.deleteMany({ where: { mysteryId: mystery.id, recipientId } });
    return { ok: true };
  }
}
