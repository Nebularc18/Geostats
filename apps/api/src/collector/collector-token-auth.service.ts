import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";

function bearerToken(header: string | undefined) {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

@Injectable()
export class CollectorTokenAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async userId(authorization: string | undefined, requiredScope = "FULL") {
    const token = bearerToken(authorization);
    if (!token) throw new UnauthorizedException("Missing collector bearer token");
    return this.userIdForToken(token, requiredScope);
  }

  async userIdForToken(token: string, requiredScope = "FULL") {
    const found = await this.prisma.collectorToken.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: { id: true, userId: true, scope: true }
    });
    if (!found) throw new UnauthorizedException("Invalid collector token");
    if (found.scope !== requiredScope) throw new UnauthorizedException("Collector token does not allow this operation");

    await this.prisma.collectorToken.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } });
    return found.userId;
  }
}
