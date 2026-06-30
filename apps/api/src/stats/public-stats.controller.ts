import { Controller, Get, Header, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { renderPublicProfileHtml, renderPublicProfileSvg } from "./public-profile-renderer";
import { StatsService } from "./stats.service";

@Controller("public")
export class PublicStatsController {
  constructor(private readonly stats: StatsService) {}

  @Get("profile-stats/:username")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  async profileStats(@Param("username") username: string) {
    const { profile, stats } = await this.stats.publicSnapshotForUsername(username);
    return renderPublicProfileHtml(profile, stats);
  }

  @Get("profile-stats-image/:username")
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  async profileStatsImage(@Param("username") username: string) {
    const { profile, stats } = await this.stats.publicSnapshotForUsername(username);
    return renderPublicProfileSvg(profile, stats);
  }

  @Get("profile-map/:asset")
  @Header("Cache-Control", "public, max-age=86400")
  profileMap(@Param("asset") asset: string, @Res() response: Response) {
    if (!/^ProjectGC_[A-Za-z0-9_.-]+\.svg$/.test(asset)) {
      throw new NotFoundException("Map asset not found");
    }

    const filePath = join(__dirname, "map-assets", asset);
    if (!existsSync(filePath)) {
      throw new NotFoundException("Map asset not found");
    }

    response.type("image/svg+xml").send(readFileSync(filePath));
  }
}
