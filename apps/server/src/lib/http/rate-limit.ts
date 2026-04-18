import type { FastifyRequest } from "fastify";

export type RateLimitRule = {
  key: string;
  max: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getRule(request: FastifyRequest): RateLimitRule {
  const url = request.url.startsWith("/api/v1/")
    ? request.url.slice("/api/v1".length)
    : request.url;

  if (url.startsWith("/api/auth/login") || url.startsWith("/api/auth/mfa/verify")) {
    return { key: "auth-login", max: 5, windowMs: 60_000 };
  }

  if (url.startsWith("/api/auth/register") || url.startsWith("/api/auth/refresh")) {
    return { key: "auth-register", max: 10, windowMs: 60_000 };
  }

  return { key: "default", max: 120, windowMs: 60_000 };
}

export function consumeRateLimit(request: FastifyRequest) {
  const rule = getRule(request);
  const now = Date.now();
  const bucketKey = `${rule.key}:${request.ip}`;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + rule.windowMs };
    buckets.set(bucketKey, bucket);
    return {
      allowed: true as const,
      limit: rule.max,
      remaining: Math.max(rule.max - 1, 0),
      resetAt: bucket.resetAt
    };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= rule.max,
    limit: rule.max,
    remaining: Math.max(rule.max - existing.count, 0),
    resetAt: existing.resetAt
  };
}
