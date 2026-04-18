import { createHash } from "node:crypto";
import { createClient } from "redis";

export type CacheStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  getVersion(key: string): Promise<number | null>;
  setVersion(key: string, value: number, ttlSeconds: number): Promise<void>;
  bumpVersion(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
};

class MemoryCacheStore implements CacheStore {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();
  private readonly versions = new Map<string, { value: number; expiresAt: number }>();

  private now() {
    return Date.now();
  }

  private sweepExpired() {
    const now = this.now();

    for (const [key, entry] of this.values.entries()) {
      if (entry.expiresAt <= now) {
        this.values.delete(key);
      }
    }

    for (const [key, entry] of this.versions.entries()) {
      if (entry.expiresAt <= now) {
        this.versions.delete(key);
      }
    }
  }

  async get(key: string) {
    this.sweepExpired();
    const entry = this.values.get(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, ttlSeconds: number) {
    this.values.set(key, {
      value,
      expiresAt: this.now() + ttlSeconds * 1000
    });
  }

  async delete(key: string) {
    this.values.delete(key);
  }

  async getVersion(key: string) {
    this.sweepExpired();
    return this.versions.get(key)?.value ?? null;
  }

  async setVersion(key: string, value: number, ttlSeconds: number) {
    this.versions.set(key, {
      value,
      expiresAt: this.now() + ttlSeconds * 1000
    });
  }

  async bumpVersion(key: string, ttlSeconds: number) {
    this.sweepExpired();
    const current = this.versions.get(key)?.value ?? 0;
    const next = current + 1;
    this.versions.set(key, {
      value: next,
      expiresAt: this.now() + ttlSeconds * 1000
    });
    return next;
  }

  async close() {}
}

class RedisCacheStore implements CacheStore {
  constructor(
    private readonly client: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
      del(key: string): Promise<unknown>;
      incr(key: string): Promise<number>;
      expire(key: string, ttlSeconds: number): Promise<unknown>;
      quit(): Promise<unknown>;
      isOpen: boolean;
    }
  ) {}

  async get(key: string) {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number) {
    await this.client.set(key, value, { EX: ttlSeconds });
  }

  async delete(key: string) {
    await this.client.del(key);
  }

  async getVersion(key: string) {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async setVersion(key: string, value: number, ttlSeconds: number) {
    await this.client.set(key, String(value), { EX: ttlSeconds });
  }

  async bumpVersion(key: string, ttlSeconds: number) {
    const next = await this.client.incr(key);
    if (next === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return next;
  }

  async close() {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }
}

let cacheStorePromise: Promise<CacheStore> | null = null;

async function createCacheStore(): Promise<CacheStore> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return new MemoryCacheStore();
  }

  try {
    const client = createClient({ url: redisUrl });
    client.on("error", (error) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "cache.redis.error",
          error: error instanceof Error ? error.message : String(error)
        })
      );
    });
    await client.connect();
    return new RedisCacheStore(client);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "cache.redis.unavailable_fallback_memory",
        error: error instanceof Error ? error.message : String(error)
      })
    );
    return new MemoryCacheStore();
  }
}

export async function getCacheStore() {
  cacheStorePromise ??= createCacheStore();
  return cacheStorePromise;
}

export async function closeCacheStore() {
  if (!cacheStorePromise) {
    return;
  }

  const store = await cacheStorePromise;
  await store.close();
  cacheStorePromise = null;
}

type CacheScope = {
  kind: "family" | "family_search" | "user";
  id: string;
};

const VERSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function getVersionKey(scope: CacheScope) {
  return `cache:version:${scope.kind}:${scope.id}`;
}

async function readScopeVersion(scope: CacheScope) {
  const store = await getCacheStore();
  const versionKey = getVersionKey(scope);
  let version = await store.getVersion(versionKey);

  if (version === null) {
    version = 1;
    await store.setVersion(versionKey, version, VERSION_TTL_SECONDS);
  }

  return String(version);
}

function buildScopedSuffix(parts: unknown[]) {
  return createHash("sha1")
    .update(JSON.stringify(parts))
    .digest("hex");
}

export async function readThroughScopedJsonCache<T>(params: {
  scopes: CacheScope[];
  keyParts: unknown[];
  ttlSeconds: number;
  loader: () => Promise<T>;
}) {
  const store = await getCacheStore();
  const versions = await Promise.all(params.scopes.map((scope) => readScopeVersion(scope)));
  const scopedPrefix = params.scopes
    .map((scope, index) => `${scope.kind}:${scope.id}:v${versions[index]}`)
    .join("|");
  const cacheKey = `cache:json:${scopedPrefix}:${buildScopedSuffix(params.keyParts)}`;

  const cached = await store.get(cacheKey);
  if (cached !== null) {
    return {
      value: JSON.parse(cached) as T,
      cacheStatus: "hit" as const
    };
  }

  const value = await params.loader();
  await store.set(cacheKey, JSON.stringify(value), params.ttlSeconds);

  return {
    value,
    cacheStatus: "miss" as const
  };
}

async function bestEffortInvalidate(scope: CacheScope) {
  try {
    const store = await getCacheStore();
    await store.bumpVersion(getVersionKey(scope), VERSION_TTL_SECONDS);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "cache.invalidate.failed",
        scopeKind: scope.kind,
        scopeId: scope.id,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

export async function invalidateFamilyCache(familyId: string) {
  await bestEffortInvalidate({ kind: "family", id: familyId });
}

export async function invalidateFamilySearchCache(familyId: string) {
  await bestEffortInvalidate({ kind: "family_search", id: familyId });
}

export async function invalidateUserCache(userId: string) {
  await bestEffortInvalidate({ kind: "user", id: userId });
}
