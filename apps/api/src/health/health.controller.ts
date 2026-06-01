import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { ImportQueueService } from "../queue/import-queue.service";
import { StorageService } from "../storage/storage.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: ImportQueueService,
    private readonly storage: StorageService
  ) {}

  @Get()
  async health() {
    const checks = await Promise.allSettled([
      this.prisma.user.count({ take: 1 }),
      this.queue.ping(),
      this.storage.ping()
    ]);
    const names = ["database", "redis", "s3"];
    const checkStatuses = Object.fromEntries(
      checks.map((result, index) => [names[index], result.status === "fulfilled" ? "ok" : "unhealthy"])
    );

    if (checks.some((result) => result.status === "rejected")) {
      throw new ServiceUnavailableException({ status: "error", checks: checkStatuses });
    }

    return { status: "ok", checks: checkStatuses };
  }
}
