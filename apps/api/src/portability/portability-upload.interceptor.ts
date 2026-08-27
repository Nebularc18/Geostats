import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskStorage } from "multer";
import { Observable, Subscription } from "rxjs";

type PortabilityUploadRequest = Express.Request & {
  user?: { id?: string };
  portabilityUploadDirectory?: string;
};

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

async function preparePortabilityUploadDirectory(directory: string) {
  await preparePortabilityTempRoot();
  await mkdir(directory, { recursive: false, mode: 0o700 });
  return directory;
}

async function cleanupPortabilityUploadDirectory(directory: string) {
  await rm(directory, { recursive: true, force: true });
}

export const portabilityDiskStorage = diskStorage({
  destination: (request, _file, callback) => {
    const directory = (request as PortabilityUploadRequest).portabilityUploadDirectory;
    if (!directory) {
      callback(new Error("Portability upload was not admitted"), "");
      return;
    }
    void preparePortabilityUploadDirectory(directory)
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
  private readonly uploadsInProgress = new Set<string>();

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<PortabilityUploadRequest>();
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException("Authentication required");
    if (this.uploadsInProgress.has(userId)) {
      throw new ServiceUnavailableException(
        "Your portability import is already in progress",
      );
    }
    this.uploadsInProgress.add(userId);
    const uploadDirectory = join(TEMP_ROOT, randomUUID());
    request.portabilityUploadDirectory = uploadDirectory;

    return new Observable((subscriber) => {
      let finished = false;
      const finish = (notify: () => void) => {
        if (finished) return;
        finished = true;
        void this.cleanupUploadDirectory(uploadDirectory)
          .then(() => {
            this.uploadsInProgress.delete(userId);
            notify();
          })
          .catch((error: unknown) => {
            this.logger.error(
              "Failed to clean the portability upload directory",
              error,
            );
            this.uploadsInProgress.delete(userId);
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

  protected cleanupUploadDirectory(directory: string) {
    return cleanupPortabilityUploadDirectory(directory);
  }

  async onModuleDestroy() {
    await cleanupPortabilityTempRoot();
    this.uploadsInProgress.clear();
  }
}
