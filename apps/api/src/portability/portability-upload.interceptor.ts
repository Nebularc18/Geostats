import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskStorage } from "multer";
import { Observable, Subscription } from "rxjs";

const TEMP_ROOT = join(
  tmpdir(),
  `geostats-portability-${process.pid}-${randomUUID()}`,
);

export async function preparePortabilityTempRoot() {
  await mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 });
  await chmod(TEMP_ROOT, 0o700);
  return TEMP_ROOT;
}

export async function cleanupPortabilityTempRoot() {
  await rm(TEMP_ROOT, { recursive: true, force: true });
}

export const portabilityDiskStorage = diskStorage({
  destination: (_request, _file, callback) => {
    void preparePortabilityTempRoot()
      .then((path) => callback(null, path))
      .catch((error) => callback(error, ""));
  },
  filename: (_request, _file, callback) =>
    callback(null, `geostats-portability-${randomUUID()}.json`),
});

@Injectable()
export class PortabilityUploadAdmissionInterceptor
  implements NestInterceptor, OnModuleDestroy
{
  private readonly logger = new Logger(
    PortabilityUploadAdmissionInterceptor.name,
  );
  private uploadInProgress = false;

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (this.uploadInProgress) {
      throw new ServiceUnavailableException(
        "Another portability import is already in progress",
      );
    }
    this.uploadInProgress = true;

    return new Observable((subscriber) => {
      let finished = false;
      const finish = (notify: () => void) => {
        if (finished) return;
        finished = true;
        void cleanupPortabilityTempRoot()
          .then(() => {
            this.uploadInProgress = false;
            notify();
          })
          .catch((error: unknown) => {
            this.logger.error(
              "Failed to clean the portability upload directory; uploads remain disabled",
              error,
            );
            notify();
          });
      };

      let subscription: Subscription | undefined;
      try {
        subscription = next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => finish(() => subscriber.error(error)),
          complete: () => finish(() => subscriber.complete()),
        });
      } catch (error) {
        finish(() => subscriber.error(error));
      }

      return () => {
        subscription?.unsubscribe();
        finish(() => undefined);
      };
    });
  }

  async onModuleDestroy() {
    await cleanupPortabilityTempRoot();
    this.uploadInProgress = false;
  }
}
