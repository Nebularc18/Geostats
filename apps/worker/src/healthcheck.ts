import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import IORedis from "ioredis";
import { PrismaClient } from "@geostats/db";
import { envOrDefault, requiredEnv, validateRuntimeEnv } from "./config/env";

async function main() {
  validateRuntimeEnv();

  const redis = new IORedis(requiredEnv("REDIS_URL"), {
    maxRetriesPerRequest: 0,
    lazyConnect: true
  });
  const prisma = new PrismaClient();
  const s3 = new S3Client({
    endpoint: envOrDefault("S3_ENDPOINT", "http://localhost:9000"),
    region: envOrDefault("S3_REGION", "us-east-1"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY")
    }
  });

  try {
    await prisma.user.count({ take: 1 });
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== "PONG") {
      throw new Error(`Redis ping returned ${pong}`);
    }
    await s3.send(new HeadBucketCommand({ Bucket: requiredEnv("S3_BUCKET") }));
  } finally {
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
