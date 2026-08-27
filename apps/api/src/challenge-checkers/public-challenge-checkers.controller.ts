import { Controller, Get, Header, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ChallengeCheckersService } from "./challenge-checkers.service";

@Controller("public/challenge-checkers")
export class PublicChallengeCheckersController {
  constructor(private readonly checkers: ChallengeCheckersService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":slug")
  @Header("Cache-Control", "public, max-age=60")
  async run(@Param("slug") slug: string) { return this.checkers.runPublic(slug); }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(":username/:gcCode")
  @Header("Cache-Control", "public, max-age=60")
  async runForCache(@Param("username") username: string, @Param("gcCode") gcCode: string) {
    return this.checkers.runPublicForCache(username, gcCode);
  }
}
