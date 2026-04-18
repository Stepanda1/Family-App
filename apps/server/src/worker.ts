import { randomUUID } from "node:crypto";
import { claimOutboxBatch, markOutboxDead, markOutboxDone, markOutboxRetry } from "./lib/outbox/outbox.js";
import { handleOutboxEvent } from "./lib/outbox/handlers.js";
import { observeBackgroundJob } from "./observability/metrics.js";

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number) {
  const base = 5_000;
  const max = 5 * 60_000;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 1_000);
  return exp + jitter;
}

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`.trim();
  }
  return String(error);
}

async function main() {
  const workerId = process.env.WORKER_ID ?? randomUUID();
  const pollMs = Number(process.env.WORKER_POLL_MS ?? 1_000);
  const leaseMs = Number(process.env.WORKER_LEASE_MS ?? 60_000);
  const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 10);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });

  console.log(JSON.stringify({ level: "info", msg: "outbox.worker.start", workerId, pollMs, leaseMs, batchSize }));

  while (!stopping) {
    const batch = await claimOutboxBatch({ workerId, limit: batchSize, leaseMs });
    if (!batch.length) {
      await sleep(Math.max(200, pollMs));
      continue;
    }

    for (const event of batch) {
      const startedAt = process.hrtime.bigint();
      try {
        await handleOutboxEvent({ eventId: event.id, type: event.type, payload: event.payload });
        await markOutboxDone({ eventId: event.id, workerId });
        observeBackgroundJob({
          component: "worker",
          job: event.type,
          status: "success",
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
        });
        console.log(
          JSON.stringify({
            level: "info",
            msg: "outbox.event.done",
            workerId,
            eventId: event.id,
            type: event.type,
            attempts: event.attempts
          })
        );
      } catch (error) {
        const message = stringifyError(error);
        if (event.attempts >= event.maxAttempts) {
          await markOutboxDead({ eventId: event.id, workerId, error: message });
          observeBackgroundJob({
            component: "worker",
            job: event.type,
            status: "dead",
            durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
          });
          console.log(
            JSON.stringify({
              level: "error",
              msg: "outbox.event.dead",
              workerId,
              eventId: event.id,
              type: event.type,
              attempts: event.attempts
            })
          );
          continue;
        }

        const delayMs = backoffMs(event.attempts);
        await markOutboxRetry({ eventId: event.id, workerId, availableAt: new Date(Date.now() + delayMs), error: message });
        observeBackgroundJob({
          component: "worker",
          job: event.type,
          status: "retry",
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
        });
        console.log(
          JSON.stringify({
            level: "warn",
            msg: "outbox.event.retry",
            workerId,
            eventId: event.id,
            type: event.type,
            attempts: event.attempts,
            delayMs
          })
        );
      }
    }
  }

  console.log(JSON.stringify({ level: "info", msg: "outbox.worker.stop", workerId }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
