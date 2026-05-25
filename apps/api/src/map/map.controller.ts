import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

const MAP_CACHE_LIMIT = 5000;

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
      take: MAP_CACHE_LIMIT + 1
    });
    const truncated = finds.length > MAP_CACHE_LIMIT;
    const visibleFinds = truncated ? finds.slice(0, MAP_CACHE_LIMIT) : finds;

    return {
      truncated,
      limit: MAP_CACHE_LIMIT,
      points: visibleFinds.map((find) => ({
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
