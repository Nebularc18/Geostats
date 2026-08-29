import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ChallengeCheckersService } from "./challenge-checkers.service";

@Controller("challenge-checkers")
@UseGuards(AuthGuard)
export class ChallengeCheckersController {
  constructor(private readonly checkers: ChallengeCheckersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) { return this.checkers.list(user.id); }

  @Get("locations")
  async locations(@CurrentUser() user: AuthUser) { return { countries: await this.checkers.locationsForUser(user.id) }; }

  @Get("catalog")
  async catalog(@CurrentUser() user: AuthUser) { return this.checkers.catalogForUser(user.id); }

  @Get("location-catalog")
  async locationCatalog(@CurrentUser() user: AuthUser, @Query("country") country?: string, @Query("region") region?: string) {
    return this.checkers.locationCatalogForUser(user.id, country, region);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return { checker: await this.checkers.create(user.id, body) };
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return { checker: await this.checkers.update(user.id, id, body) };
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.checkers.remove(user.id, id); }

  @Post(":id/run")
  async run(@CurrentUser() user: AuthUser, @Param("id") id: string) { return this.checkers.runOwned(user.id, id); }

  @Patch(":id/publish")
  async publish(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: { published?: unknown }) {
    return { checker: await this.checkers.setPublished(user.id, id, body.published) };
  }
}
