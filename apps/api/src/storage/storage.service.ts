import { Injectable } from "@nestjs/common";
import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { envOrDefault, requiredEnv } from "../common/env";

const OBJECT_WRITE_TIMEOUT_MS = 20_000;

@Injectable()
export class StorageService {
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

  async putObject(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType
      }),
      { abortSignal: AbortSignal.timeout(OBJECT_WRITE_TIMEOUT_MS) }
    );
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      }),
      { abortSignal: AbortSignal.timeout(OBJECT_WRITE_TIMEOUT_MS) }
    );
  }

  async ping() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
