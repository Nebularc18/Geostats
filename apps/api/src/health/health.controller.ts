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
    const failed = checks
      .map((result, index) => ({ result, name: ["database", "redis", "s3"][index] }))
      .filter((check): check is { result: PromiseRejectedResult; name: string } => check.result.status === "rejected");

    if (failed.length > 0) {
      throw new ServiceUnavailableException({
        status: "error",
        checks: Object.fromEntries(failed.map((check) => [check.name, "unhealthy"]))
      });
    }

    return { status: "ok", checks: { database: "ok", redis: "ok", s3: "ok" } };
  }
}
