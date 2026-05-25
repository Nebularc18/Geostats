import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { ProfileController } from "./profile.controller";

@Module({
  imports: [AuthModule],
  controllers: [ProfileController],
  providers: [PrismaService]
})
export class ProfileModule {}
