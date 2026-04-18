import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma.js";
import { enqueueOutboxEvent } from "./lib/outbox/outbox.js";
import { observeBackgroundJob } from "./observability/metrics.js";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type DueReminderRow = {
  id: string;
  familyId: string;
  title: string;
};

async function enqueueDueReminders(params: { limit: number }) {
  const limit = Math.max(1, Math.min(200, params.limit));
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<DueReminderRow[]>(Prisma.sql`
      WITH due AS (
        SELECT id, "familyId", title
        FROM tasks
        WHERE
          "reminderAt" IS NOT NULL
          AND "reminderSentAt" IS NULL
          AND "reminderAt" <= NOW()
          AND status NOT IN ('DONE', 'CANCELLED')
        ORDER BY "reminderAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE tasks t
      SET "reminderSentAt" = NOW(), "updatedAt" = NOW()
      FROM due
      WHERE t.id = due.id
      RETURNING t.id, t."familyId", t.title
    `);

    if (!due.length) {
      return { enqueued: 0 };
    }

    for (const row of due) {
      await enqueueOutboxEvent(tx, {
        familyId: row.familyId,
        type: "task.reminder",
        payload: { taskId: row.id, familyId: row.familyId, title: row.title },
        availableAt: now,
        maxAttempts: 10
      });
    }

    return { enqueued: due.length };
  });
}

async function main() {
  const cronId = process.env.CRON_ID ?? randomUUID();
  const intervalMs = Number(process.env.CRON_INTERVAL_MS ?? 60_000);
  const limit = Number(process.env.CRON_BATCH_SIZE ?? 50);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  console.log(JSON.stringify({ level: "info", msg: "cron.start", cronId, intervalMs, limit }));

  while (!stopping) {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await enqueueDueReminders({ limit });
      observeBackgroundJob({
        component: "cron",
        job: "enqueue_due_reminders",
        status: "success",
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
      });
      if (result.enqueued) {
        console.log(JSON.stringify({ level: "info", msg: "cron.reminders.enqueued", cronId, count: result.enqueued }));
      }
    } catch (error) {
      observeBackgroundJob({
        component: "cron",
        job: "enqueue_due_reminders",
        status: "error",
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
      });
      console.log(JSON.stringify({ level: "error", msg: "cron.error", cronId, error: String(error) }));
    }

    await sleep(Math.max(5_000, intervalMs));
  }

  console.log(JSON.stringify({ level: "info", msg: "cron.stop", cronId }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
