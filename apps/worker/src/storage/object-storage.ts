import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { envOrDefault, requiredEnv } from "../config/env";

const DEFAULT_MAX_OBJECT_BYTES = 15 * 1024 * 1024;

function maxObjectBytes(): number {
  const parsed = Number(process.env.IMPORT_MAX_BYTES ?? process.env.UPLOAD_MAX_BYTES ?? DEFAULT_MAX_OBJECT_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OBJECT_BYTES;
}

export class ObjectStorage {
  private readonly bucket = envOrDefault("S3_BUCKET", "geostats-imports");
  private readonly client = new S3Client({
    endpoint: envOrDefault("S3_ENDPOINT", "http://localhost:9000"),
    region: envOrDefault("S3_REGION", "us-east-1"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    credentials: {
      accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY")
    }
  });

  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const limit = maxObjectBytes();
    if (response.ContentLength != null && response.ContentLength > limit) {
      throw new Error(`Import object exceeds ${limit} bytes`);
    }

    const body = response.Body;
    if (!(body instanceof Readable)) {
      throw new Error("S3 object body was not readable");
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) {
        throw new Error(`Import object exceeds ${limit} bytes`);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
}
