import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { ArrayMaxSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

class ProfileDto {
  @IsNotEmpty()
  @MaxLength(60)
  gcUsername!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  homeLatitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  homeLongitude?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  ftfDetectionTerms?: string[];
}

function cleanFtfDetectionTerms(terms: string[] | undefined): string[] {
  const cleaned = (terms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return [...new Set(cleaned)].slice(0, 20);
}

@Controller("profile")
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getProfile(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId: user.id } });
    return { profile };
  }

  @Put()
  async updateProfile(@CurrentUser() user: AuthUser, @Body() body: ProfileDto) {
    const profile = await this.prisma.$transaction(async (tx) => {
      const ftfDetectionTerms = cleanFtfDetectionTerms(body.ftfDetectionTerms);
      const ftfDetectionData = body.ftfDetectionTerms === undefined ? {} : { ftfDetectionTerms };
      const updated = await tx.geocachingProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          gcUsername: body.gcUsername,
          homeLatitude: body.homeLatitude ?? null,
          homeLongitude: body.homeLongitude ?? null,
          ...ftfDetectionData
        },
        update: {
          gcUsername: body.gcUsername,
          homeLatitude: body.homeLatitude ?? null,
          homeLongitude: body.homeLongitude ?? null,
          ...ftfDetectionData
        }
      });
      await tx.statSnapshot.deleteMany({ where: { userId: user.id } });
      return updated;
    });
    return { profile };
  }
}
