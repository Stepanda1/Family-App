import { randomUUID } from "node:crypto";
import "../lib/load-env.js";
import { buildApp } from "../app.js";
import {
  invalidateFamilyCache,
  invalidateFamilySearchCache,
  invalidateUserCache
} from "../lib/cache/store.js";
import { prisma } from "../lib/prisma.js";

type Scenario = {
  name: string;
  url: string;
  invalidate: () => Promise<void>;
};

type Measurement = {
  durationMs: number;
  cacheHeader: string | null;
  statusCode: number;
};

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

function summarize(label: string, values: Measurement[]) {
  const durations = values.map((entry) => entry.durationMs);
  const hits = values.filter((entry) => entry.cacheHeader === "hit").length;
  const misses = values.filter((entry) => entry.cacheHeader === "miss").length;

  return {
    label,
    avgMs: average(durations),
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    hitRatio: hits / values.length,
    missCount: misses
  };
}

function formatSummary(name: string, cold: ReturnType<typeof summarize>, warm: ReturnType<typeof summarize>) {
  const delta = cold.avgMs - warm.avgMs;
  const speedup = warm.avgMs > 0 ? cold.avgMs / warm.avgMs : 0;

  return [
    `Endpoint: ${name}`,
    `  cold avg/p50/p95: ${cold.avgMs.toFixed(2)} / ${cold.p50Ms.toFixed(2)} / ${cold.p95Ms.toFixed(2)} ms`,
    `  warm avg/p50/p95: ${warm.avgMs.toFixed(2)} / ${warm.p50Ms.toFixed(2)} / ${warm.p95Ms.toFixed(2)} ms`,
    `  warm hit ratio: ${(warm.hitRatio * 100).toFixed(0)}%`,
    `  delta avg: ${delta.toFixed(2)} ms`,
    `  speedup: ${speedup.toFixed(2)}x`
  ].join("\n");
}

async function main() {
  process.env.LOG_LEVEL ??= "error";
  const app = await buildApp();

  try {
    const membership = await prisma.familyMembership.findFirst({
      orderBy: { createdAt: "asc" },
      select: {
        familyId: true,
        userId: true
      }
    });

    if (!membership) {
      throw new Error("No family memberships found. Seed the database before running the cache benchmark.");
    }

    const token = app.jwt.sign(
      {
        sid: randomUUID(),
        amr: ["benchmark"],
        mfa: false
      },
      {
        sub: membership.userId
      }
    );

    const authHeaders = {
      authorization: `Bearer ${token}`
    };

    const searchParams = new URLSearchParams({
      limit: "20"
    });

    const iterations = Number(process.env.CACHE_BENCH_ITERATIONS ?? 15);
    const scenarios: Scenario[] = [
      {
        name: "GET /api/my/families",
        url: "/api/my/families",
        invalidate: () => invalidateUserCache(membership.userId)
      },
      {
        name: "GET /api/families/:familyId/overview",
        url: `/api/families/${membership.familyId}/overview`,
        invalidate: () => invalidateFamilyCache(membership.familyId)
      },
      {
        name: "GET /api/families/:familyId/settings",
        url: `/api/families/${membership.familyId}/settings`,
        invalidate: () => invalidateFamilyCache(membership.familyId)
      },
      {
        name: "GET /api/families/:familyId/calendar",
        url: `/api/families/${membership.familyId}/calendar`,
        invalidate: () => invalidateFamilyCache(membership.familyId)
      },
      {
        name: "GET /api/families/:familyId/tasks",
        url: `/api/families/${membership.familyId}/tasks`,
        invalidate: () => invalidateFamilyCache(membership.familyId)
      },
      {
        name: "GET /api/families/:familyId/shopping",
        url: `/api/families/${membership.familyId}/shopping`,
        invalidate: () => invalidateFamilyCache(membership.familyId)
      },
      {
        name: "GET /api/families/:familyId/search/tasks",
        url: `/api/families/${membership.familyId}/search/tasks?${searchParams.toString()}`,
        invalidate: () => invalidateFamilySearchCache(membership.familyId)
      }
    ];

    console.log(
      [
        "Cache benchmark",
        `Iterations per mode: ${iterations}`,
        `User: ${membership.userId}`,
        `Family: ${membership.familyId}`,
        ""
      ].join("\n")
    );

    for (const scenario of scenarios) {
      const coldMeasurements: Measurement[] = [];
      const warmMeasurements: Measurement[] = [];

      for (let index = 0; index < iterations; index += 1) {
        await scenario.invalidate();
        coldMeasurements.push(
          await measureRequest(app, {
            url: scenario.url,
            headers: authHeaders,
            remoteAddress: `10.0.0.${index + 1}`
          })
        );
      }

      await scenario.invalidate();
      await measureRequest(app, {
        url: scenario.url,
        headers: authHeaders,
        remoteAddress: "10.1.0.1"
      });

      for (let index = 0; index < iterations; index += 1) {
        warmMeasurements.push(
          await measureRequest(app, {
            url: scenario.url,
            headers: authHeaders,
            remoteAddress: `10.2.0.${index + 1}`
          })
        );
      }

      const coldSummary = summarize("cold", coldMeasurements);
      const warmSummary = summarize("warm", warmMeasurements);
      console.log(formatSummary(scenario.name, coldSummary, warmSummary));
      console.log("");
    }
  } finally {
    await prisma.$disconnect();
    await app.close();
  }
}

async function measureRequest(
  app: Awaited<ReturnType<typeof buildApp>>,
  input: {
    url: string;
    headers: Record<string, string>;
    remoteAddress: string;
  }
) {
  const startedAt = performance.now();
  const response = await app.inject({
    method: "GET",
    url: input.url,
    headers: input.headers,
    remoteAddress: input.remoteAddress
  });
  const durationMs = performance.now() - startedAt;
  const cacheHeader = response.headers["x-cache"];

  if (response.statusCode !== 200) {
    throw new Error(`Benchmark request failed for ${input.url}: ${response.statusCode} ${response.body}`);
  }

  return {
    durationMs,
    cacheHeader: typeof cacheHeader === "string" ? cacheHeader : null,
    statusCode: response.statusCode
  } satisfies Measurement;
}

await main();
