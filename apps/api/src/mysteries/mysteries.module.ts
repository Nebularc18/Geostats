import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { MysteriesController } from "./mysteries.controller";

@Module({
  imports: [AuthModule],
  controllers: [MysteriesController],
  providers: [PrismaService]
})
export class MysteriesModule {}
