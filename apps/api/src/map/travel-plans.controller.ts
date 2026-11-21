import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { AuthUser, normalizeTravelPlan, stableJsonStringify, validTravelPlanId } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

type VersionedPlanInput = { plan?: unknown; version?: unknown };

@Controller("travel-plans")
@UseGuards(AuthGuard)
export class TravelPlansController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.travelPlan.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { data: true, version: true }
    });
    return { plans: rows.flatMap(({ data, version }) => {
      const plan = normalizeTravelPlan(data);
      return plan ? [{ ...plan, version }] : [];
    }) };
  }

  @Put(":id")
  async save(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: VersionedPlanInput) {
    const plan = normalizeTravelPlan(body?.plan);
    const version = body?.version;
    if (!plan || plan.id !== id || typeof version !== "number" || !Number.isSafeInteger(version) || version < 0 || version >= 2_147_483_647) {
      throw new BadRequestException("This trip contains invalid data");
    }
    const data = plan as Prisma.InputJsonObject;
    const result = version === 0
      ? await this.prisma.travelPlan.createMany({ data: { id, userId: user.id, data }, skipDuplicates: true })
      : await this.prisma.travelPlan.updateMany({
        where: { id, userId: user.id, version, deletedAt: null },
        data: { data, version: { increment: 1 } }
      });
    if (!result.count) {
      const current = await this.prisma.travelPlan.findUnique({ where: { userId_id: { userId: user.id, id } } });
      if (current && !current.deletedAt && stableJsonStringify(current.data) === stableJsonStringify(plan)) {
        return { plan: { ...plan, version: current.version } };
      }
      throw new ConflictException("This trip changed on another device. Reload the list and try again.");
    }
    return { plan: { ...plan, version: version + 1 } };
  }

  @Post("migrate")
  async migrate(@CurrentUser() user: AuthUser, @Body("plans") values: unknown) {
    if (!Array.isArray(values) || !values.length || values.length > 100) {
      throw new BadRequestException("Choose between 1 and 100 trips to move");
    }
    const plans = values.map((value) => {
      const plan = normalizeTravelPlan(value);
      if (!plan) throw new BadRequestException("A browser trip contains invalid data");
      return plan;
    });
    if (new Set(plans.map(({ id }) => id)).size !== plans.length) {
      throw new BadRequestException("Two browser trips have the same ID");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.travelPlan.createMany({
        data: plans.map((plan) => ({ id: plan.id, userId: user.id, data: plan as Prisma.InputJsonObject })),
        skipDuplicates: true
      });
      const stored = await tx.travelPlan.findMany({
        where: { userId: user.id, id: { in: plans.map(({ id }) => id) }, deletedAt: null },
        select: { id: true, version: true, data: true }
      });
      const byId = new Map(stored.map((row) => [row.id, row]));
      return { plans: plans.flatMap((plan) => {
        const matched = byId.get(plan.id);
        return matched && stableJsonStringify(matched.data) === stableJsonStringify(plan)
          ? [{ ...plan, version: matched.version }] : [];
      }) };
    });
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body("version") version: unknown) {
    if (!validTravelPlanId(id) || typeof version !== "number" || !Number.isSafeInteger(version) || version <= 0 || version >= 2_147_483_647) {
      throw new BadRequestException("A valid trip version is required");
    }
    const result = await this.prisma.travelPlan.updateMany({
      where: { id, userId: user.id, version, deletedAt: null },
      data: { deletedAt: new Date(), data: Prisma.JsonNull, version: { increment: 1 } }
    });
    if (!result.count) {
      const current = await this.prisma.travelPlan.findUnique({ where: { userId_id: { userId: user.id, id } } });
      if (!current?.deletedAt) throw new ConflictException("This trip changed on another device. Reload the list and try again.");
    }
    return { deleted: true };
  }
}
