import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_EXCHANGE_CODE_CAPACITY,
  MobileExchangeCodeService
} from "./mobile-exchange-code.service";

class TestRedis {
  readonly records = new Map<string, { expiresAt: number; value: string }>();
  readonly index = new Map<string, number>();
  lastTtl: number | null = null;

  async eval(_script: string, keyCount: number, ...args: Array<string | number>) {
    if (keyCount === 1) {
      const [indexKey, keyPrefix, code, payload, nowValue, expiresAtValue, ttlValue, capacityValue] = args;
      assert.equal(indexKey, "geostats:{mobile-auth}:exchange-codes");
      const now = Number(nowValue);
      const expiresAt = Number(expiresAtValue);
      const ttl = Number(ttlValue);
      const capacity = Number(capacityValue);
      const key = `${keyPrefix}${code}`;
      this.lastTtl = ttl;

      for (const [indexedCode, indexedExpiry] of this.index) {
        if (indexedExpiry <= now) {
          this.index.delete(indexedCode);
        }
      }
      if (this.records.has(key)) {
        return 0;
      }
      this.records.set(key, { expiresAt, value: String(payload) });
      this.index.set(String(code), expiresAt);

      const excess = this.index.size - capacity;
      const evicted = [...this.index.entries()]
        .sort((left, right) => left[1] - right[1])
        .slice(0, Math.max(0, excess));
      for (const [evictedCode] of evicted) {
        this.index.delete(evictedCode);
        this.records.delete(`${keyPrefix}${evictedCode}`);
      }
      return 1;
    }

    const [codeKey, indexKey, serialized, code] = args;
    assert.equal(indexKey, "geostats:{mobile-auth}:exchange-codes");
    const record = this.records.get(String(codeKey));
    if (!record || record.value !== serialized) {
      return null;
    }
    this.records.delete(String(codeKey));
    this.index.delete(String(code));
    return serialized;
  }

  async get(key: string) {
    const record = this.records.get(key);
    if (!record || record.expiresAt <= Date.now()) {
      this.records.delete(key);
      return null;
    }
    return record.value;
  }

  async quit() {
    return "OK";
  }
}

const user = { id: "user-1", email: "a@example.com", username: "a" };

test("mobile exchange codes survive service recreation and remain one-time", async () => {
  const redis = new TestRedis();
  const callbackService = new MobileExchangeCodeService(redis as any);
  const code = await callbackService.create("jwt-token", user, "A".repeat(43));

  const exchangeService = new MobileExchangeCodeService(redis as any);
  const record = await exchangeService.get(code);
  assert.ok(record);
  assert.equal(record.token, "jwt-token");
  assert.equal(await exchangeService.consume(code, record.serialized), true);
  assert.equal(await exchangeService.get(code), null);
  assert.equal(await exchangeService.consume(code, record.serialized), false);
  assert.equal(redis.lastTtl, 2 * 60 * 1000);
});

test("mobile exchange code storage stays at its capacity", async () => {
  const redis = new TestRedis();
  const service = new MobileExchangeCodeService(redis as any);
  await service.create("jwt-0", user, "A".repeat(43));

  for (let index = 1; index <= MOBILE_EXCHANGE_CODE_CAPACITY; index += 1) {
    await service.create(`jwt-${index}`, user, "A".repeat(43));
  }

  assert.equal(redis.index.size, MOBILE_EXCHANGE_CODE_CAPACITY);
  assert.equal(redis.records.size, MOBILE_EXCHANGE_CODE_CAPACITY);
});
