import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { StatsService } from "./stats.service";

@Controller("stats")
@UseGuards(AuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get("summary")
  async summary(@CurrentUser() user: AuthUser) {
    const stats = await this.stats.snapshotForUser(user.id);
    return { stats };
  }

  @Get("finds-by-month")
  async findsByMonth(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return { findsByMonth: stats.findsByMonth ?? [], findsByYear: stats.findsByYear ?? [] };
  }

  @Get("cache-types")
  async cacheTypes(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return { cacheTypes: stats.cacheTypes ?? [] };
  }

  @Get("difficulty-terrain")
  async difficultyTerrain(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return { difficultyTerrain: stats.difficultyTerrain ?? [] };
  }

  @Get("sizes")
  async sizes(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return { sizes: stats.sizes ?? [] };
  }

  @Get("locations")
  async locations(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return {
      countries: stats.countries ?? [],
      regions: stats.regions ?? [],
      counties: stats.counties ?? []
    };
  }

  @Get("milestones")
  async milestones(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return { milestones: stats.milestones ?? [] };
  }

  @Get("streaks")
  async streaks(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return { streaks: stats.streaks ?? { longest: 0, current: 0 } };
  }

  @Get("ftf/finds")
  async ftfFinds(
    @CurrentUser() user: AuthUser,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ) {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException("limit must be a positive integer");
    }
    return this.stats.ftfFindsForUser(user.id, { cursor, limit: parsedLimit });
  }

  @Patch("ftf/finds/:id")
  async updateFtfFind(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() body: { isFtf?: unknown }
  ) {
    if (typeof body.isFtf !== "boolean") {
      throw new BadRequestException("isFtf must be a boolean");
    }

    return { find: await this.stats.updateFtfFlag(user.id, id, body.isFtf) };
  }
}
