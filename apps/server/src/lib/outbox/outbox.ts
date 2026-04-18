import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export type OutboxEventPayload = Record<string, unknown>;

export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  params: {
    familyId?: string | null;
    type: string;
    payload: OutboxEventPayload;
    availableAt?: Date;
    maxAttempts?: number;
  }
) {
  return tx.outboxEvent.create({
    data: {
      familyId: params.familyId ?? null,
      type: params.type,
      payload: params.payload as any,
      availableAt: params.availableAt ?? new Date(),
      maxAttempts: params.maxAttempts ?? 20
    }
  });
}

type ClaimedOutboxEvent = {
  id: string;
  familyId: string | null;
  type: string;
  payload: unknown;
  status: "PENDING" | "PROCESSING" | "DONE" | "DEAD";
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
  deadAt: Date | null;
};

export async function claimOutboxBatch(params: { workerId: string; limit: number; leaseMs: number }) {
  const limit = Math.max(1, Math.min(100, params.limit));
  const leaseMs = Math.max(10_000, Math.min(10 * 60_000, params.leaseMs));

  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
      WITH picked AS (
        SELECT id
        FROM outbox_events
        WHERE
          status IN ('PENDING', 'PROCESSING')
          AND "availableAt" <= NOW()
          AND attempts < "maxAttempts"
          AND (
            status = 'PENDING'
            OR ("lockedAt" IS NOT NULL AND "lockedAt" < (NOW() - (${leaseMs} * INTERVAL '1 millisecond')))
          )
        ORDER BY "availableAt" ASC, "createdAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE outbox_events e
      SET
        status = 'PROCESSING',
        "lockedAt" = NOW(),
        "lockedBy" = ${params.workerId},
        attempts = attempts + 1,
        "updatedAt" = NOW()
      FROM picked
      WHERE e.id = picked.id
      RETURNING
        e.id,
        e."familyId",
        e.type,
        e.payload,
        e.status,
        e."availableAt",
        e."lockedAt",
        e."lockedBy",
        e.attempts,
        e."maxAttempts",
        e."lastError",
        e."createdAt",
        e."updatedAt",
        e."processedAt",
        e."deadAt"
    `);

    return rows;
  });

  return claimed;
}

export async function markOutboxDone(params: { eventId: string; workerId: string }) {
  await prisma.outboxEvent.updateMany({
    where: { id: params.eventId, lockedBy: params.workerId, status: "PROCESSING" },
    data: {
      status: "DONE",
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null
    }
  });
}

export async function markOutboxRetry(params: {
  eventId: string;
  workerId: string;
  availableAt: Date;
  error: string;
}) {
  await prisma.outboxEvent.updateMany({
    where: { id: params.eventId, lockedBy: params.workerId, status: "PROCESSING" },
    data: {
      status: "PENDING",
      availableAt: params.availableAt,
      lockedAt: null,
      lockedBy: null,
      lastError: params.error
    }
  });
}

export async function markOutboxDead(params: { eventId: string; workerId: string; error: string }) {
  await prisma.outboxEvent.updateMany({
    where: { id: params.eventId, lockedBy: params.workerId, status: "PROCESSING" },
    data: {
      status: "DEAD",
      deadAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: params.error
    }
  });
}
