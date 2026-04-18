import { createHash, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";
import { AppError } from "./problem.js";

type StoredResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  body: unknown;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function hashBody(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function extractReplayHeaders(reply: Pick<FastifyReply, "getHeader">) {
  const etag = reply.getHeader("etag");
  const contentType = reply.getHeader("content-type");
  const headers: Record<string, string> = {};

  if (typeof etag === "string") {
    headers.etag = etag;
  }

  if (typeof contentType === "string") {
    headers["content-type"] = contentType;
  }

  return headers;
}

type IdempotencyRequestLike = Pick<
  FastifyRequest,
  "headers" | "ip" | "user"
>;

function getSubject(request: IdempotencyRequestLike) {
  if (request.user?.sub) {
    return `user:${request.user.sub}`;
  }

  return `ip:${request.ip}`;
}

export async function executeIdempotent<T>(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  operation: string;
  body: unknown;
  handler: () => Promise<T>;
  statusCode?: number;
}) {
  const rawKeyHeader = params.request.headers["idempotency-key"];
  const idempotencyKey = Array.isArray(rawKeyHeader)
    ? rawKeyHeader[0]
    : rawKeyHeader;

  if (!idempotencyKey) {
    return params.handler();
  }

  const requestHash = hashBody(params.body);
  const subject = getSubject(params.request);
  const reservationId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const inserted = await prisma.$queryRaw<{ inserted: boolean }[]>`
    INSERT INTO api_idempotency_keys (
      id,
      "idempotencyKey",
      operation,
      subject,
      "requestHash",
      status,
      "createdAt",
      "updatedAt",
      "expiresAt"
    )
    VALUES (
      ${reservationId}::uuid,
      ${idempotencyKey},
      ${params.operation},
      ${subject},
      ${requestHash},
      'PROCESSING',
      ${now},
      ${now},
      ${expiresAt}
    )
    ON CONFLICT ("idempotencyKey", operation, subject)
    DO NOTHING
    RETURNING true as inserted
  `;

  if (!inserted.length) {
    const existingRows = await prisma.$queryRaw<
      Array<{
        id: string;
        requestHash: string;
        status: string;
        responseStatusCode: number | null;
        responseHeaders: Record<string, string> | null;
        responseBody: unknown;
      }>
    >`
      SELECT
        id,
        "requestHash",
        status,
        "responseStatusCode",
        "responseHeaders",
        "responseBody"
      FROM api_idempotency_keys
      WHERE "idempotencyKey" = ${idempotencyKey}
        AND operation = ${params.operation}
        AND subject = ${subject}
      LIMIT 1
    `;

    const existing = existingRows[0];
    if (!existing) {
      throw new AppError({
        status: 409,
        title: "Idempotency conflict",
        detail: "The request is already being processed.",
        code: "IDEMPOTENCY_CONFLICT"
      });
    }

    if (existing.requestHash !== requestHash) {
      throw new AppError({
        status: 409,
        title: "Idempotency key reused with different payload",
        detail: "Reuse the same Idempotency-Key only with an identical request body.",
        code: "IDEMPOTENCY_PAYLOAD_MISMATCH"
      });
    }

    if (existing.status === "COMPLETED" && existing.responseStatusCode) {
      const headers = existing.responseHeaders ?? {};
      for (const [header, value] of Object.entries(headers)) {
        params.reply.header(header, value);
      }
      params.reply.header("idempotency-replayed", "true");
      params.reply.code(existing.responseStatusCode);
      return existing.responseBody as T;
    }

    throw new AppError({
      status: 409,
      title: "Idempotency request in progress",
      detail: "A request with this Idempotency-Key is already being processed.",
      code: "IDEMPOTENCY_IN_PROGRESS"
    });
  }

  try {
    const result = await params.handler();
    const response: StoredResponse = {
      statusCode:
        params.reply.statusCode >= 200
          ? params.reply.statusCode
          : (params.statusCode ?? 200),
      headers: extractReplayHeaders(params.reply),
      body: result
    };

    await prisma.$executeRaw`
      UPDATE api_idempotency_keys
      SET status = 'COMPLETED',
          "responseStatusCode" = ${response.statusCode},
          "responseHeaders" = ${JSON.stringify(response.headers ?? {})}::jsonb,
          "responseBody" = ${JSON.stringify(response.body)}::jsonb,
          "updatedAt" = NOW()
      WHERE id = ${reservationId}::uuid
    `;

    return result;
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE api_idempotency_keys
      SET status = 'FAILED',
          "errorMessage" = ${error instanceof Error ? error.message : "Unknown idempotency error"},
          "updatedAt" = NOW()
      WHERE id = ${reservationId}::uuid
    `;
    throw error;
  }
}
