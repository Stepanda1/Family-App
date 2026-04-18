import { Prisma, type EmailDeliveryStatus } from "@prisma/client";
import { z } from "zod";
import { invalidateFamilySearchCache } from "../cache/store.js";
import { prisma } from "../prisma.js";

const emailSendPayloadSchema = z.object({
  toEmail: z.string().email().max(254),
  subject: z.string().min(1).max(140),
  body: z.string().min(1).max(20_000)
});

const taskReminderPayloadSchema = z.object({
  taskId: z.string().uuid(),
  familyId: z.string().uuid()
});

const taskSearchSyncPayloadSchema = z.object({
  taskId: z.string().uuid(),
  familyId: z.string().uuid()
});

const taskSearchDeletePayloadSchema = z.object({
  taskId: z.string().uuid()
});

const familyReindexPayloadSchema = z.object({
  familyId: z.string().uuid()
});

export type OutboxHandlerContext = {
  eventId: string;
  type: string;
  payload: unknown;
};

function buildTaskSearchContent(params: {
  title: string;
  description?: string | null;
  categoryName?: string | null;
  listName?: string | null;
  location?: string | null;
  executorNamesText?: string | null;
}) {
  return [
    params.title,
    params.description,
    params.categoryName,
    params.listName,
    params.location,
    params.executorNamesText
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n");
}

async function upsertTaskSearchDocument(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      category: {
        select: { name: true }
      },
      assignments: {
        include: {
          executor: {
            select: { displayName: true }
          }
        }
      }
    }
  });

  if (!task) {
    await prisma.$executeRaw`
      DELETE FROM "task_search_documents"
      WHERE "taskId" = ${taskId}::uuid
    `;
    return;
  }

  const executorNamesText = task.assignments
    .map((assignment) => assignment.executor.displayName.trim())
    .filter(Boolean)
    .join(" ");

  const contentPlain = buildTaskSearchContent({
    title: task.title,
    description: task.description,
    categoryName: task.category.name,
    listName: task.listName,
    location: task.location,
    executorNamesText
  });

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "task_search_documents" (
      "id",
      "familyId",
      "taskId",
      "itemType",
      "status",
      "priority",
      "title",
      "description",
      "categoryName",
      "listName",
      "location",
      "executorNamesText",
      "contentPlain",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      gen_random_uuid(),
      ${task.familyId}::uuid,
      ${task.id}::uuid,
      ${task.itemType}::"PlannerItemType",
      ${task.status}::"PlannerStatus",
      ${task.priority}::"PlannerPriority",
      ${task.title},
      ${task.description},
      ${task.category.name},
      ${task.listName},
      ${task.location},
      ${executorNamesText},
      ${contentPlain},
      NOW(),
      NOW()
    )
    ON CONFLICT ("taskId") DO UPDATE
    SET
      "familyId" = EXCLUDED."familyId",
      "itemType" = EXCLUDED."itemType",
      "status" = EXCLUDED."status",
      "priority" = EXCLUDED."priority",
      "title" = EXCLUDED."title",
      "description" = EXCLUDED."description",
      "categoryName" = EXCLUDED."categoryName",
      "listName" = EXCLUDED."listName",
      "location" = EXCLUDED."location",
      "executorNamesText" = EXCLUDED."executorNamesText",
      "contentPlain" = EXCLUDED."contentPlain",
      "updatedAt" = NOW()
  `);
}

async function createEmailDelivery(params: { eventId: string; toEmail: string; subject: string; body: string; status?: EmailDeliveryStatus }) {
  try {
    await prisma.emailDelivery.create({
      data: {
        outboxEventId: params.eventId,
        toEmail: params.toEmail.toLowerCase(),
        subject: params.subject,
        body: params.body,
        status: params.status ?? "SENT"
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }
}

async function handleEmailSend(ctx: OutboxHandlerContext) {
  const payload = emailSendPayloadSchema.parse(ctx.payload);

  await createEmailDelivery({
    eventId: ctx.eventId,
    toEmail: payload.toEmail,
    subject: payload.subject,
    body: payload.body,
    status: "SENT"
  });

  // Placeholder side-effect: "send" by recording it, then logging.
  // Real provider integration can be added later without changing the outbox contract.
  console.log(
    JSON.stringify({
      level: "info",
      msg: "email.sent",
      outboxEventId: ctx.eventId,
      to: payload.toEmail,
      subject: payload.subject
    })
  );
}

async function handleTaskReminder(ctx: OutboxHandlerContext) {
  const payload = taskReminderPayloadSchema.parse(ctx.payload);

  const recipients = await prisma.familyMembership.findMany({
    where: { familyId: payload.familyId, role: { in: ["OWNER", "PARENT"] } },
    include: { user: { select: { email: true, displayName: true } } }
  });

  const task = await prisma.task.findUnique({
    where: { id: payload.taskId },
    select: { id: true, title: true, dueAt: true, reminderAt: true }
  });

  if (!task) {
    return;
  }

  const subject = `Напоминание: ${task.title}`;
  const body = [
    `Задача: ${task.title}`,
    task.dueAt ? `Дедлайн: ${task.dueAt.toISOString()}` : null,
    task.reminderAt ? `ReminderAt: ${task.reminderAt.toISOString()}` : null,
    `TaskId: ${task.id}`
  ]
    .filter(Boolean)
    .join("\n");

  for (const recipient of recipients) {
    await createEmailDelivery({
      eventId: ctx.eventId,
      toEmail: recipient.user.email,
      subject,
      body
    });
  }
}

async function handleTaskSearchSync(ctx: OutboxHandlerContext) {
  const payload = taskSearchSyncPayloadSchema.parse(ctx.payload);
  await upsertTaskSearchDocument(payload.taskId);
  await invalidateFamilySearchCache(payload.familyId);
}

async function handleTaskSearchDelete(ctx: OutboxHandlerContext) {
  const payload = taskSearchDeletePayloadSchema.parse(ctx.payload);
  const rows = await prisma.$queryRaw<Array<{ familyId: string }>>(Prisma.sql`
    SELECT "familyId"
    FROM "task_search_documents"
    WHERE "taskId" = ${payload.taskId}::uuid
    LIMIT 1
  `);

  await prisma.$executeRaw`
    DELETE FROM "task_search_documents"
    WHERE "taskId" = ${payload.taskId}::uuid
  `;

  if (rows[0]?.familyId) {
    await invalidateFamilySearchCache(rows[0].familyId);
  }
}

async function handleTaskSearchReindexFamily(ctx: OutboxHandlerContext) {
  const payload = familyReindexPayloadSchema.parse(ctx.payload);
  const tasks = await prisma.task.findMany({
    where: { familyId: payload.familyId },
    select: { id: true }
  });

  for (const task of tasks) {
    await upsertTaskSearchDocument(task.id);
  }

  if (tasks.length) {
    const taskIds = Prisma.join(
      tasks.map((task) => Prisma.sql`${task.id}::uuid`)
    );

    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "task_search_documents"
      WHERE "familyId" = ${payload.familyId}::uuid
        AND "taskId" NOT IN (${taskIds})
    `);
    await invalidateFamilySearchCache(payload.familyId);
    return;
  }

  await prisma.$executeRaw`
    DELETE FROM "task_search_documents"
    WHERE "familyId" = ${payload.familyId}::uuid
  `;

  await invalidateFamilySearchCache(payload.familyId);
  return;
}

const handlers: Record<string, (ctx: OutboxHandlerContext) => Promise<void>> = {
  "email.send": handleEmailSend,
  "task.reminder": handleTaskReminder,
  "task.search.sync": handleTaskSearchSync,
  "task.search.delete": handleTaskSearchDelete,
  "task.search.reindex_family": handleTaskSearchReindexFamily
};

export async function handleOutboxEvent(ctx: OutboxHandlerContext) {
  const handler = handlers[ctx.type];
  if (!handler) {
    throw new Error(`Unknown outbox event type: ${ctx.type}`);
  }
  await handler(ctx);
}
