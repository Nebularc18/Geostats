import { Controller, Get, Header, NotFoundException, Param, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  PROFILE_SVG_CONTENT_SECURITY_POLICY,
  PUBLIC_PROFILE_CONTENT_SECURITY_POLICY,
  renderPublicExtremesSvg,
  renderPublicProfileHtml,
  renderPublicProfileSvg,
  renderPublicScratchMapSvg
} from "./public-profile-renderer";
import { StatsService } from "./stats.service";
import { loadWorldMapTemplate } from "./map-assets";

@Controller("public")
export class PublicStatsController {
  constructor(private readonly stats: StatsService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(["profile-stats/:username", "profile-stats/by-id/:profileId"])
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Content-Security-Policy", PUBLIC_PROFILE_CONTENT_SECURITY_POLICY)
  @Header("Cache-Control", "no-store")
  async profileStats(@Param("username") username?: string, @Param("profileId") profileId?: string) {
    const { profile, stats } = await this.stats.publicSnapshotForLink(username, profileId);
    return renderPublicProfileHtml(profile, stats, { mapImageUrl: `/public/profile-scratch-map-image/by-id/${encodeURIComponent(profile.id)}` });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(["profile-stats-image/:username", "profile-stats-image/by-id/:profileId"])
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @Header("Content-Security-Policy", PROFILE_SVG_CONTENT_SECURITY_POLICY)
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "no-store")
  async profileStatsImage(@Param("username") username?: string, @Param("profileId") profileId?: string) {
    const { profile, stats } = await this.stats.publicSnapshotForLink(username, profileId);
    return renderPublicProfileSvg(profile, stats);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(["profile-extremes-image/:username", "profile-extremes-image/by-id/:profileId"])
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @Header("Content-Security-Policy", PROFILE_SVG_CONTENT_SECURITY_POLICY)
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "no-store")
  async profileExtremesImage(@Param("username") username?: string, @Param("profileId") profileId?: string) {
    const { profile, stats } = await this.stats.publicSnapshotForLink(username, profileId);
    return renderPublicExtremesSvg(profile, stats.extremeCaches);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(["profile-scratch-map-image/:username", "profile-scratch-map-image/by-id/:profileId"])
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @Header("Content-Security-Policy", PROFILE_SVG_CONTENT_SECURITY_POLICY)
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  @Header("Cache-Control", "no-store")
  async profileScratchMapImage(@Param("username") username?: string, @Param("profileId") profileId?: string) {
    const { profile, stats } = await this.stats.publicSnapshotForLink(username, profileId);
    let worldMapTemplate: string;
    try {
      worldMapTemplate = await loadWorldMapTemplate();
    } catch {
      throw new NotFoundException("Map asset not found");
    }
    return renderPublicScratchMapSvg(profile, stats, worldMapTemplate);
  }

  @Get("profile-map/:asset")
  @Header("Cache-Control", "public, max-age=86400")
  async profileMap(@Param("asset") asset: string, @Res() response: Response) {
    if (!/^ProjectGC_[A-Za-z0-9_.-]+\.svg$/.test(asset)) {
      throw new NotFoundException("Map asset not found");
    }

    const filePath = join(__dirname, "map-assets", asset);
    try {
      const content = await readFile(filePath);
      response.type("image/svg+xml").send(content);
    } catch {
      throw new NotFoundException("Map asset not found");
    }
  }
}
