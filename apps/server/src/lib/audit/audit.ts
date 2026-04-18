import type { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "../prisma.js";

type ActorSnapshot = {
  userId: string | null;
  sessionId: string | null;
  email: string | null;
  displayName: string | null;
};

export async function getAuditActorSnapshot(request: FastifyRequest): Promise<ActorSnapshot> {
  const cached = (request as any).__actorSnapshot as ActorSnapshot | undefined;
  if (cached) {
    return cached;
  }

  const userId = request.user?.sub ?? null;
  const sessionId = request.user?.sid ?? null;
  if (!userId) {
    const anonymous = { userId: null, sessionId, email: null, displayName: null };
    (request as any).__actorSnapshot = anonymous;
    return anonymous;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true }
  });

  const snapshot = {
    userId,
    sessionId,
    email: user?.email ?? null,
    displayName: user?.displayName ?? null
  };

  (request as any).__actorSnapshot = snapshot;
  return snapshot;
}

export async function logAuditEvent(
  tx: Prisma.TransactionClient,
  params: {
    request: FastifyRequest;
    actor?: ActorSnapshot;
    familyId?: string | null;
    actorFamilyRole?: "OWNER" | "PARENT" | "CHILD" | "GUEST" | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    diff?: unknown;
    metadata?: Record<string, unknown>;
  }
) {
  const actor = params.actor ?? (await getAuditActorSnapshot(params.request));
  const requestContext = params.request.requestContext;

  return tx.auditEvent.create({
    data: {
      familyId: params.familyId ?? null,
      actorUserId: actor.userId,
      actorSessionId: actor.sessionId,
      actorFamilyRole: params.actorFamilyRole ?? null,
      actorEmail: actor.email,
      actorDisplayName: actor.displayName,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      diff: params.diff as any,
      ipAddress: params.request.ip,
      userAgent: params.request.headers["user-agent"],
      correlationId: requestContext.correlationId,
      traceId: requestContext.traceId,
      spanId: requestContext.spanId,
      metadata: params.metadata as any
    }
  });
}
