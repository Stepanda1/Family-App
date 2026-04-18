import type { FastifyReply, FastifyRequest } from "fastify";

type ProblemRequestLike = Pick<FastifyRequest, "url" | "requestContext">;

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  errors?: unknown;
  [key: string]: unknown;
};

const DEFAULT_TITLES = new Map<number, string>([
  [400, "Bad Request"],
  [401, "Unauthorized"],
  [403, "Forbidden"],
  [404, "Not Found"],
  [409, "Conflict"],
  [410, "Gone"],
  [412, "Precondition Failed"],
  [422, "Unprocessable Entity"],
  [429, "Too Many Requests"],
  [500, "Internal Server Error"],
  [501, "Not Implemented"],
  [503, "Service Unavailable"]
]);

export class AppError extends Error {
  status: number;
  type: string;
  code?: string;
  errors?: unknown;
  extensions?: Record<string, unknown>;

  constructor(params: {
    status: number;
    detail?: string;
    title?: string;
    type?: string;
    code?: string;
    errors?: unknown;
    extensions?: Record<string, unknown>;
  }) {
    super(
      params.detail ??
        params.title ??
        DEFAULT_TITLES.get(params.status) ??
        "Request failed"
    );
    this.name = "AppError";
    this.status = params.status;
    this.type = params.type ?? `https://family-app.local/problems/${params.status}`;
    this.code = params.code;
    this.errors = params.errors;
    this.extensions = params.extensions;
  }
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}

export function buildProblemDetails(
  request: ProblemRequestLike,
  params: {
    status: number;
    title?: string;
    detail?: string;
    type?: string;
    code?: string;
    errors?: unknown;
    extensions?: Record<string, unknown>;
  }
): ProblemDetails {
  const ctx = request.requestContext;

  return {
    type: params.type ?? `https://family-app.local/problems/${params.status}`,
    title: params.title ?? DEFAULT_TITLES.get(params.status) ?? "Request failed",
    status: params.status,
    detail: params.detail,
    instance: request.url,
    code: params.code,
    correlationId: ctx.correlationId,
    traceId: ctx.traceId ?? undefined,
    spanId: ctx.spanId ?? undefined,
    errors: params.errors,
    ...(params.extensions ?? {})
  };
}

export function normalizeProblemBody(
  request: ProblemRequestLike,
  statusCode: number,
  payload: unknown
) {
  if (isProblemDetails(payload)) {
    return {
      ...payload,
      correlationId:
        payload.correlationId ?? request.requestContext.correlationId,
      traceId: payload.traceId ?? request.requestContext.traceId ?? undefined,
      spanId: payload.spanId ?? request.requestContext.spanId ?? undefined,
      instance: payload.instance ?? request.url,
      status: payload.status || statusCode
    } satisfies ProblemDetails;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return buildProblemDetails(request, {
      status: statusCode,
      title: typeof record.title === "string" ? record.title : undefined,
      detail:
        typeof record.detail === "string"
          ? record.detail
          : typeof record.message === "string"
            ? record.message
            : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
      code: typeof record.code === "string" ? record.code : undefined,
      errors: record.issues ?? record.errors,
      extensions: Object.fromEntries(
        Object.entries(record).filter(
          ([key]) =>
            ![
              "title",
              "detail",
              "message",
              "type",
              "code",
              "issues",
              "errors",
              "status"
            ].includes(key)
        )
      )
    });
  }

  return buildProblemDetails(request, {
    status: statusCode,
    detail: typeof payload === "string" ? payload : undefined
  });
}

export function sendProblem(
  reply: FastifyReply,
  request: ProblemRequestLike,
  params: {
    status: number;
    title?: string;
    detail?: string;
    type?: string;
    code?: string;
    errors?: unknown;
    extensions?: Record<string, unknown>;
  }
) {
  const body = buildProblemDetails(request, params);
  return reply
    .code(params.status)
    .type("application/problem+json")
    .send(body);
}
