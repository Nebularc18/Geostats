import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  PUBLIC_PROFILE_CONTENT_SECURITY_POLICY,
  renderPublicProfileHtml,
  renderPublicScratchMapSvg
} from "./public-profile-renderer";
import { loadWorldMapTemplate } from "./map-assets";
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

  @Get("html")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Content-Security-Policy", PUBLIC_PROFILE_CONTENT_SECURITY_POLICY)
  @Header("Cache-Control", "no-store")
  async html(@CurrentUser() user: AuthUser) {
    const { profile, stats } = await this.stats.profileSnapshotForUser(user.id);
    return renderPublicProfileHtml(profile, stats, { mapImageUrl: "/stats/scratch-map-image" });
  }

  @Get("scratch-map-image")
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @Header("Cache-Control", "no-store")
  async scratchMapImage(@CurrentUser() user: AuthUser) {
    const { profile, stats } = await this.stats.profileSnapshotForUser(user.id);
    const worldMapTemplate = await loadWorldMapTemplate();
    return renderPublicScratchMapSvg(profile, stats, worldMapTemplate);
  }

  @Get("compare/:username")
  async compare(@CurrentUser() user: AuthUser, @Param("username") username: string) {
    return this.stats.friendComparisonForUser(user.id, username);
  }

  @Get("friends")
  async friends(@CurrentUser() user: AuthUser) {
    return this.stats.savedFriendsForUser(user.id);
  }

  @Post("friends")
  async addFriend(@CurrentUser() user: AuthUser, @Body() body: { username?: unknown }) {
    if (typeof body.username !== "string" || !body.username.trim()) {
      throw new BadRequestException("username is required");
    }
    return this.stats.saveFriendForUser(user.id, body.username);
  }

  @Delete("friends/:username")
  async removeFriend(@CurrentUser() user: AuthUser, @Param("username") username: string) {
    return this.stats.removeSavedFriendForUser(user.id, username);
  }

  @Get("cache/:gcCode")
  async cacheDetail(@CurrentUser() user: AuthUser, @Param("gcCode") gcCode: string) {
    return this.stats.cacheDetailForUser(user.id, gcCode);
  }

  @Get("finds")
  async finds(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("cacheType") cacheType?: string,
    @Query("size") size?: string,
    @Query("country") country?: string,
    @Query("region") region?: string,
    @Query("county") county?: string,
    @Query("difficulty") difficulty?: string,
    @Query("terrain") terrain?: string,
    @Query("foundMonthDay") foundMonthDay?: string,
    @Query("hiddenYearMonth") hiddenYearMonth?: string,
    @Query("year") year?: string,
    @Query("owner") owner?: string,
    @Query("ftfOnly") ftfOnly?: string,
    @Query("sort") sort?: string,
    @Query("offset") offset?: string,
    @Query("limit") limit?: string
  ) {
    return this.stats.findsForUser(user.id, {
      q,
      cacheType,
      size,
      country,
      region,
      county,
      difficulty: difficulty ? Number(difficulty) : undefined,
      terrain: terrain ? Number(terrain) : undefined,
      foundMonthDay,
      hiddenYearMonth,
      year,
      owner,
      ftfOnly: ftfOnly === "true" || ftfOnly === "1",
      sort,
      offset: offset ? Number(offset) : 0,
      limit: limit ? Number(limit) : 50
    });
  }

  @Get("finds-by-month")
  async findsByMonth(@CurrentUser() user: AuthUser) {
    const stats = (await this.stats.snapshotForUser(user.id)) as any;
    return {
      findsByMonth: stats.findsByMonth ?? [],
      findsByYear: stats.findsByYear ?? []
    };
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

  @Get("extreme-caches")
  async extremeCaches(@CurrentUser() user: AuthUser, @Query("country") country?: string, @Query("region") region?: string) {
    return this.stats.extremeCachesForUser(user.id, country ?? null, region ?? null);
  }

  @Get("ftf/finds")
  async ftfFinds(@CurrentUser() user: AuthUser, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException("limit must be a positive integer");
    }
    return this.stats.ftfFindsForUser(user.id, { cursor, limit: parsedLimit });
  }

  @Patch("ftf/finds/:id")
  async updateFtfFind(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: { isFtf?: unknown }) {
    if (typeof body.isFtf !== "boolean") {
      throw new BadRequestException("isFtf must be a boolean");
    }

    return { find: await this.stats.updateFtfFlag(user.id, id, body.isFtf) };
  }
}
