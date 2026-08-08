import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { MysteriesController } from "./mysteries.controller";
import { CollectorModule } from "../collector/collector.module";
import { MysteryAgentController } from "./mystery-agent.controller";

@Module({
  imports: [AuthModule, CollectorModule],
  controllers: [MysteriesController, MysteryAgentController],
  providers: [PrismaService]
})
export class MysteriesModule {}
