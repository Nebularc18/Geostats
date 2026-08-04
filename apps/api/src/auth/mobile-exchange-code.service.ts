import { Inject, Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import IORedis from "ioredis";
import { randomBytes } from "node:crypto";
import { requiredEnv } from "../common/env";

const CODE_TTL_MS = 2 * 60 * 1000;
export const MOBILE_EXCHANGE_CODE_CAPACITY = 1_000;
const KEY_PREFIX = "geostats:{mobile-auth}:exchange:";
const INDEX_KEY = "geostats:{mobile-auth}:exchange-codes";

type MobileExchangeCodeRecord = {
  codeChallenge: string;
  token: string;
  user: AuthUser;
};

type StoredMobileExchangeCode = MobileExchangeCodeRecord & {
  serialized: string;
};

type RedisConnection = Pick<IORedis, "eval" | "get" | "quit">;
const MOBILE_EXCHANGE_REDIS = Symbol("MOBILE_EXCHANGE_REDIS");

const CREATE_CODE_SCRIPT = `
local indexKey = KEYS[1]
local keyPrefix = ARGV[1]
local code = ARGV[2]
local payload = ARGV[3]
local now = tonumber(ARGV[4])
local expiresAt = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
local capacity = tonumber(ARGV[7])

redis.call("ZREMRANGEBYSCORE", indexKey, "-inf", now)
local created = redis.call("SET", keyPrefix .. code, payload, "PX", ttl, "NX")
if not created then
  return 0
end

redis.call("ZADD", indexKey, expiresAt, code)
local excess = redis.call("ZCARD", indexKey) - capacity
if excess > 0 then
  local evicted = redis.call("ZRANGE", indexKey, 0, excess - 1)
  for _, evictedCode in ipairs(evicted) do
    redis.call("DEL", keyPrefix .. evictedCode)
  end
  redis.call("ZREM", indexKey, unpack(evicted))
end
return 1
`;

const CONSUME_CODE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current or current ~= ARGV[1] then
  return nil
end
redis.call("DEL", KEYS[1])
redis.call("ZREM", KEYS[2], ARGV[2])
return current
`;

@Injectable()
export class MobileExchangeCodeService implements OnModuleDestroy {
  private readonly connection: RedisConnection;
  private readonly ownsConnection: boolean;

  constructor(@Inject(MOBILE_EXCHANGE_REDIS) @Optional() connection?: RedisConnection) {
    this.connection = connection ?? new IORedis(requiredEnv("REDIS_URL"), { maxRetriesPerRequest: null });
    this.ownsConnection = !connection;
  }

  async create(token: string, user: AuthUser, codeChallenge: string): Promise<string> {
    const serialized = JSON.stringify({ codeChallenge, token, user } satisfies MobileExchangeCodeRecord);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = randomBytes(32).toString("base64url");
      const now = Date.now();
      const result = await this.connection.eval(
        CREATE_CODE_SCRIPT,
        1,
        INDEX_KEY,
        KEY_PREFIX,
        code,
        serialized,
        now,
        now + CODE_TTL_MS,
        CODE_TTL_MS,
        MOBILE_EXCHANGE_CODE_CAPACITY
      );
      if (result === 1) {
        return code;
      }
    }

    throw new Error("Could not allocate a unique mobile exchange code");
  }

  async get(code: string): Promise<StoredMobileExchangeCode | null> {
    const serialized = await this.connection.get(`${KEY_PREFIX}${code}`);
    if (!serialized) {
      return null;
    }

    try {
      const record = JSON.parse(serialized) as Partial<MobileExchangeCodeRecord>;
      if (typeof record.codeChallenge !== "string" || typeof record.token !== "string" || !record.user) {
        return null;
      }
      return {
        codeChallenge: record.codeChallenge,
        token: record.token,
        user: record.user,
        serialized
      };
    } catch {
      return null;
    }
  }

  async consume(code: string, serialized: string): Promise<boolean> {
    const result = await this.connection.eval(
      CONSUME_CODE_SCRIPT,
      2,
      `${KEY_PREFIX}${code}`,
      INDEX_KEY,
      serialized,
      code
    );
    return result === serialized;
  }

  async onModuleDestroy() {
    if (this.ownsConnection) {
      await this.connection.quit();
    }
  }
}
