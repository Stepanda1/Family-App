import { createHash, randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { ZodError } from "zod";
import { closeCacheStore } from "./lib/cache/store.js";
import { consumeRateLimit } from "./lib/http/rate-limit.js";
import { applyRequestContextHeaders, buildRequestContext } from "./lib/http/request-context.js";
import { AppError, normalizeProblemBody, sendProblem } from "./lib/http/problem.js";
import { prisma } from "./lib/prisma.js";
import {
  observeHttpRequestEnd,
  observeHttpRequestStart,
  renderPrometheusMetrics
} from "./observability/metrics.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFamilyRoutes } from "./routes/families.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerTaskRoutes } from "./routes/tasks.js";

function buildEtag(payload: string) {
  return `"${createHash("sha1").update(payload).digest("hex")}"`;
}

function getRequestId(request: { headers?: Record<string, string | string[] | undefined> }) {
  const headerValue = request.headers?.["x-request-id"];
  return typeof headerValue === "string" && headerValue.trim()
    ? headerValue.trim()
    : randomUUID();
}

function resolveRouteLabel(request: {
  routeOptions?: { url?: string };
  routerPath?: string;
  url: string;
}) {
  return request.routeOptions?.url ?? request.routerPath ?? request.url;
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    },
    genReqId: getRequestId
  });

  const authRequired = (process.env.AUTH_REQUIRED ?? "").toLowerCase() === "true";
  const jwtSecret = process.env.JWT_ACCESS_SECRET ?? "dev-insecure-jwt-secret-change-me";
  if (!process.env.JWT_ACCESS_SECRET) {
    if (authRequired) {
      throw new Error("JWT_ACCESS_SECRET is required when AUTH_REQUIRED=true.");
    }
    app.log.warn("JWT_ACCESS_SECRET is not set; using an insecure development default.");
  }

  await app.register(jwt, {
    secret: jwtSecret
  });

  await app.register(cors, {
    origin: true
  });

  app.addHook("onRequest", async (request, reply) => {
    request.observabilityStartNs = process.hrtime.bigint();
    observeHttpRequestStart();
    request.requestContext = buildRequestContext(request);
    applyRequestContextHeaders(reply, request);

    const rateLimit = consumeRateLimit(request);
    reply.header("x-ratelimit-limit", rateLimit.limit);
    reply.header("x-ratelimit-remaining", rateLimit.remaining);
    reply.header("x-ratelimit-reset", Math.ceil(rateLimit.resetAt / 1000));

    if (!rateLimit.allowed) {
      return sendProblem(reply, request, {
        status: 429,
        detail: "Too many requests. Retry after the current rate-limit window resets.",
        code: "RATE_LIMITED"
      });
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request.observabilityStartNs;
    const durationMs =
      startedAt !== undefined
        ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
        : 0;
    const route = resolveRouteLabel(request);

    observeHttpRequestEnd({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs
    });

    request.log.info({
      msg: "http.request.complete",
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: Number(durationMs.toFixed(3)),
      requestId: request.id,
      correlationId: request.requestContext.correlationId,
      traceId: request.requestContext.traceId,
      spanId: request.requestContext.spanId,
      apiVersion: request.requestContext.apiVersion
    });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    applyRequestContextHeaders(reply, request);

    if (reply.statusCode >= 400) {
      let parsed: unknown = payload;
      if (typeof payload === "string") {
        try {
          parsed = JSON.parse(payload);
        } catch {
          parsed = payload;
        }
      }

      const problem = normalizeProblemBody(request, reply.statusCode, parsed);
      reply.type("application/problem+json");
      return JSON.stringify(problem);
    }

    const contentTypeHeader = reply.getHeader("content-type");
    const contentType =
      typeof contentTypeHeader === "string" ? contentTypeHeader : undefined;
    if (
      request.method === "GET" &&
      typeof payload === "string" &&
      contentType?.includes("application/json")
    ) {
      const etag = buildEtag(payload);
      reply.header("etag", etag);

      const ifNoneMatch = request.headers["if-none-match"];
      if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
        reply.code(304);
        return "";
      }
    }

    return payload;
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      return sendProblem(reply, request, {
        status: 400,
        title: "Validation error",
        detail: "Request payload validation failed.",
        code: "VALIDATION_ERROR",
        errors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    if (error instanceof AppError) {
      return sendProblem(reply, request, {
        status: error.status,
        type: error.type,
        detail: error.message,
        code: error.code,
        errors: error.errors,
        extensions: error.extensions
      });
    }

    const statusCode = typeof (error as any).statusCode === "number" ? (error as any).statusCode : null;
    if (statusCode && statusCode >= 400 && statusCode < 600) {
      return sendProblem(reply, request, {
        status: statusCode,
        detail: (error as any).message ?? "Request failed"
      });
    }

    request.log.error({
      err: error,
      correlationId: request.requestContext.correlationId,
      traceId: request.requestContext.traceId,
      spanId: request.requestContext.spanId
    });
    return sendProblem(reply, request, {
      status: 500,
      detail: "Internal server error",
      code: "INTERNAL_SERVER_ERROR"
    });
  });

  app.get("/health", async () => ({
    ok: true,
    service: "family-app-api",
    version: "v1"
  }));

  app.get("/health/live", async () => ({
    ok: true,
    service: "family-app-api"
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, checks: { database: "up" } };
    } catch {
      reply.code(503);
      return { ok: false, checks: { database: "down" } };
    }
  });

  app.get("/metrics", async (_request, reply) => {
    const metrics = await renderPrometheusMetrics();
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return metrics;
  });

  app.addHook("onClose", async () => {
    await closeCacheStore();
  });

  if (authRequired) {
    app.addHook("onRequest", async (request, reply) => {
      const url = request.url;
      if (
        url === "/health" ||
        url === "/health/live" ||
        url === "/health/ready" ||
        url === "/metrics" ||
        url.startsWith("/api/auth/")
      ) {
        return;
      }

      try {
        await request.jwtVerify();
      } catch {
        return sendProblem(reply, request, {
          status: 401,
          detail: "Unauthorized",
          code: "UNAUTHORIZED"
        });
      }
    });
  }

  await registerAuthRoutes(app);
  await registerFamilyRoutes(app);
  await registerSearchRoutes(app);
  await registerTaskRoutes(app);

  return app;
}
