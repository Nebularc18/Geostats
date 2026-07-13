import { Controller, Get, Header, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { readFile } from "fs/promises";
import { join } from "path";
import { renderPublicProfileHtml, renderPublicProfileSvg, renderPublicScratchMapSvg } from "./public-profile-renderer";
import { StatsService } from "./stats.service";

const worldMapTemplatePath = join(__dirname, "map-assets", "ProjectGC_World.svg");
let worldMapTemplatePromise: Promise<string> | null = null;

function loadWorldMapTemplate() {
  if (!worldMapTemplatePromise) {
    worldMapTemplatePromise = readFile(worldMapTemplatePath, "utf8").catch((error) => {
      worldMapTemplatePromise = null;
      throw error;
    });
  }
  return worldMapTemplatePromise;
}

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

  @Get("profile-scratch-map-image/:username")
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @Header("Cache-Control", "public, max-age=300")
  async profileScratchMapImage(@Param("username") username: string) {
    const { profile, stats } = await this.stats.publicSnapshotForUsername(username);
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
