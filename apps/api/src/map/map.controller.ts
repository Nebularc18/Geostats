import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

@Controller("map")
@UseGuards(AuthGuard)
export class MapController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("caches")
  async caches(@CurrentUser() user: AuthUser) {
    const finds = await this.prisma.find.findMany({
      where: { userId: user.id },
      include: { cache: true },
      orderBy: { foundAt: "desc" },
      take: 5000
    });

    return {
      points: finds.map((find) => ({
        id: find.cache.id,
        gcCode: find.cache.gcCode,
        name: find.cache.name,
        cacheType: find.cache.cacheType,
        latitude: Number(find.cache.latitude),
        longitude: Number(find.cache.longitude),
        foundAt: find.foundAt.toISOString()
      }))
    };
  }
}
