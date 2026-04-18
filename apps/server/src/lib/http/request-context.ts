import type { FastifyReply, FastifyRequest } from "fastify";

export type RequestContext = {
  correlationId: string;
  traceId: string | null;
  spanId: string | null;
  apiVersion: string;
};

function parseTraceparent(value: string | undefined) {
  if (!value) {
    return { traceId: null, spanId: null };
  }

  const parts = value.trim().split("-");
  if (parts.length < 4) {
    return { traceId: null, spanId: null };
  }

  const [, traceId, spanId] = parts;
  if (!/^[0-9a-f]{32}$/i.test(traceId) || !/^[0-9a-f]{16}$/i.test(spanId)) {
    return { traceId: null, spanId: null };
  }

  return { traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase() };
}

type RequestLike = Pick<FastifyRequest, "headers" | "id" | "url">;

export function buildRequestContext(request: RequestLike): RequestContext {
  const correlationIdHeader = request.headers["x-correlation-id"];
  const correlationId =
    (typeof correlationIdHeader === "string" && correlationIdHeader.trim()) ||
    request.id;
  const traceparentHeader = request.headers.traceparent;
  const traceparent = Array.isArray(traceparentHeader)
    ? traceparentHeader[0]
    : traceparentHeader;
  const { traceId, spanId } = parseTraceparent(traceparent);

  const requestedVersionHeader = request.headers["x-api-version"];
  const requestedVersion =
    typeof requestedVersionHeader === "string" && requestedVersionHeader.trim()
      ? requestedVersionHeader.trim().toLowerCase()
      : request.url.startsWith("/api/v1/")
        ? "v1"
        : "v1";

  return {
    correlationId,
    traceId,
    spanId,
    apiVersion: requestedVersion
  };
}

export function applyRequestContextHeaders(
  reply: FastifyReply,
  request: Pick<FastifyRequest, "id" | "requestContext">
) {
  const ctx = request.requestContext;
  reply.header("x-request-id", request.id);
  reply.header("x-correlation-id", ctx.correlationId);
  reply.header("x-api-version", ctx.apiVersion);

  if (ctx.traceId) {
    reply.header("x-trace-id", ctx.traceId);
  }

  if (ctx.spanId) {
    reply.header("x-span-id", ctx.spanId);
  }
}
