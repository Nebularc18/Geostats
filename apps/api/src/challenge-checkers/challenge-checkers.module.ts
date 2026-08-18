import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { ChallengeCheckersController } from "./challenge-checkers.controller";
import { ChallengeCheckersService } from "./challenge-checkers.service";
import { PublicChallengeCheckersController } from "./public-challenge-checkers.controller";
import { GeographicBoundariesService } from "./geographic-boundaries";

@Module({
  imports: [AuthModule],
  controllers: [ChallengeCheckersController, PublicChallengeCheckersController],
  providers: [ChallengeCheckersService, GeographicBoundariesService, PrismaService]
})
export class ChallengeCheckersModule {}
