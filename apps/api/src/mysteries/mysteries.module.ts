import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { MysteriesController } from "./mysteries.controller";
import { CollectorModule } from "../collector/collector.module";
import { MysteryAgentController } from "./mystery-agent.controller";
import { MysteryAccountGuard } from "./mystery-account.guard";

@Module({
  imports: [AuthModule, CollectorModule],
  controllers: [MysteriesController, MysteryAgentController],
  providers: [PrismaService, MysteryAccountGuard]
})
export class MysteriesModule {}
