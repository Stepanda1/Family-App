import { PlannerItemType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  assertTaskExecutionPermission,
  ensureFamilyCategory,
  ensureFamilyExecutors,
  ensureFamilyParticipant,
  requireFamilyCapability
} from "../lib/authz/family-access.js";
import { getAuditActorSnapshot, logAuditEvent } from "../lib/audit/audit.js";
import { invalidateFamilyCache } from "../lib/cache/store.js";
import { AppError } from "../lib/http/problem.js";
import { executeIdempotent } from "../lib/http/idempotency.js";
import { enqueueOutboxEvent } from "../lib/outbox/outbox.js";
import { prisma } from "../lib/prisma.js";
import { toPlannerItemRecord } from "../lib/serializers.js";

const createTaskSchema = z.object({
  familyId: z.string().uuid(),
  creatorParticipantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string().min(2).max(140),
  description: z.string().max(2000).optional(),
  itemType: z.nativeEnum(PlannerItemType),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  status: z.enum(["NEW", "IN_PROGRESS", "DONE", "CANCELLED"]).default("NEW"),
  listName: z.string().max(80).optional(),
  location: z.string().max(140).optional(),
  scheduledStartAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  reminderAt: z.string().datetime().optional(),
  executorIds: z.array(z.string().uuid()).default([])
});

const taskParamsSchema = z.object({
  taskId: z.string().uuid()
});

const updateTaskSchema = createTaskSchema.partial().omit({
  familyId: true
}).extend({
  executorIds: z.array(z.string().uuid()).optional()
});

const executionSchema = z.object({
  participantId: z.string().uuid(),
  actualDurationMinutes: z.number().int().positive().max(1440).optional(),
  status: z.enum(["SUCCESS", "LATE", "SKIPPED"]),
  note: z.string().max(1000).optional()
});

export async function registerTaskRoutes(
  app: FastifyInstance<any, any, any, any>
) {
  app.post("/api/tasks", async (request, reply) => {
    const payload = createTaskSchema.parse(request.body);

    const ctx = await requireFamilyCapability({
      request,
      familyId: payload.familyId,
      capability: "planner.write"
    });

    await Promise.all([
      ensureFamilyParticipant(payload.creatorParticipantId, payload.familyId, "creatorParticipantId"),
      ensureFamilyCategory(payload.categoryId, payload.familyId, "categoryId"),
      ensureFamilyExecutors(payload.executorIds, payload.familyId)
    ]);

    const actor = await getAuditActorSnapshot(request);

    const created = await executeIdempotent({
      request,
      reply,
      operation: "task.create",
      body: payload,
      statusCode: 201,
      handler: async () => {
        const task = await prisma.$transaction(async (tx) => {
          const createdTask = await tx.task.create({
            data: {
              familyId: payload.familyId,
              creatorParticipantId: payload.creatorParticipantId,
              categoryId: payload.categoryId,
              title: payload.title,
              description: payload.description,
              itemType: payload.itemType,
              priority: payload.priority,
              status: payload.status,
              listName: payload.listName,
              location: payload.location,
              scheduledStartAt: payload.scheduledStartAt
                ? new Date(payload.scheduledStartAt)
                : undefined,
              dueAt: payload.dueAt ? new Date(payload.dueAt) : undefined,
              reminderAt: payload.reminderAt
                ? new Date(payload.reminderAt)
                : undefined,
              assignments: payload.executorIds.length
                ? {
                    create: payload.executorIds.map((executorId) => ({
                      executorId
                    }))
                  }
                : undefined
            },
            include: {
              category: true,
              assignments: {
                include: {
                  executor: true
                }
              }
            }
          });

          await logAuditEvent(tx, {
            request,
            actor,
            familyId: payload.familyId,
            actorFamilyRole: ctx.role,
            action: "task.create",
            entityType: "Task",
            entityId: createdTask.id,
            diff: { after: toPlannerItemRecord(createdTask) }
          });

          await enqueueOutboxEvent(tx, {
            familyId: payload.familyId,
            type: "task.search.sync",
            payload: {
              familyId: payload.familyId,
              taskId: createdTask.id
            }
          });

          return createdTask;
        });

        return toPlannerItemRecord(task);
      }
    });

    const statusCode = reply.statusCode >= 200 ? reply.statusCode : 201;
    await invalidateFamilyCache(payload.familyId);
    return reply.code(statusCode).send(created);
  });

  app.patch("/api/tasks/:taskId", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const payload = updateTaskSchema.parse(request.body);

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: true,
        assignments: {
          include: {
            executor: true
          }
        }
      }
    });

    if (!existing) {
      throw new AppError({
        status: 404,
        code: "TASK_NOT_FOUND",
        detail: "Задача не найдена"
      });
    }

    const ctx = await requireFamilyCapability({
      request,
      familyId: existing.familyId,
      capability: "planner.write"
    });

    await Promise.all([
      payload.creatorParticipantId
        ? ensureFamilyParticipant(payload.creatorParticipantId, existing.familyId, "creatorParticipantId")
        : Promise.resolve(null),
      payload.categoryId
        ? ensureFamilyCategory(payload.categoryId, existing.familyId, "categoryId")
        : Promise.resolve(null),
      payload.executorIds
        ? ensureFamilyExecutors(payload.executorIds, existing.familyId)
        : Promise.resolve(null)
    ]);

    const actor = await getAuditActorSnapshot(request);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          creatorParticipantId: payload.creatorParticipantId,
          categoryId: payload.categoryId,
          title: payload.title,
          description: payload.description,
          itemType: payload.itemType,
          priority: payload.priority,
          status: payload.status,
          listName: payload.listName,
          location: payload.location,
          scheduledStartAt:
            payload.scheduledStartAt === undefined
              ? undefined
              : payload.scheduledStartAt
                ? new Date(payload.scheduledStartAt)
                : null,
          dueAt:
            payload.dueAt === undefined
              ? undefined
              : payload.dueAt
                ? new Date(payload.dueAt)
                : null,
          reminderAt:
            payload.reminderAt === undefined
              ? undefined
              : payload.reminderAt
                ? new Date(payload.reminderAt)
                : null
        }
      });

      if (payload.executorIds) {
        await tx.assignment.deleteMany({
          where: { taskId }
        });

        if (payload.executorIds.length) {
          await tx.assignment.createMany({
            data: payload.executorIds.map((executorId) => ({
              taskId,
              executorId
            }))
          });
        }
      }

      const after = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          category: true,
          assignments: {
            include: {
              executor: true
            }
          }
        }
      });

      if (!after) {
        return null;
      }

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: existing.familyId,
        actorFamilyRole: ctx.role,
        action: "task.update",
        entityType: "Task",
        entityId: taskId,
        diff: { before: toPlannerItemRecord(existing), after: toPlannerItemRecord(after) }
      });

      await enqueueOutboxEvent(tx, {
        familyId: existing.familyId,
        type: "task.search.sync",
        payload: {
          familyId: existing.familyId,
          taskId
        }
      });

      return after;
    });

    await invalidateFamilyCache(existing.familyId);
    return reply.send(updated ? toPlannerItemRecord(updated) : null);
  });

  app.delete("/api/tasks/:taskId", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        category: true,
        assignments: {
          include: {
            executor: true
          }
        }
      }
    });

    if (!existing) {
      throw new AppError({
        status: 404,
        code: "TASK_NOT_FOUND",
        detail: "Задача не найдена"
      });
    }

    const ctx = await requireFamilyCapability({
      request,
      familyId: existing.familyId,
      capability: "planner.write"
    });

    const actor = await getAuditActorSnapshot(request);

    await prisma.$transaction(async (tx) => {
      await tx.task.delete({
        where: { id: taskId }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: existing.familyId,
        actorFamilyRole: ctx.role,
        action: "task.delete",
        entityType: "Task",
        entityId: taskId,
        diff: { before: toPlannerItemRecord(existing) }
      });

      await enqueueOutboxEvent(tx, {
        familyId: existing.familyId,
        type: "task.search.delete",
        payload: { taskId }
      });
    });

    await invalidateFamilyCache(existing.familyId);
    return reply.code(204).send();
  });

  app.post("/api/tasks/:taskId/executions", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const payload = executionSchema.parse(request.body);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        familyId: true,
        status: true,
        completedAt: true,
        assignments: {
          select: {
            executor: {
              select: { participantId: true }
            }
          }
        }
      }
    });

    if (!task) {
      throw new AppError({
        status: 404,
        code: "TASK_NOT_FOUND",
        detail: "Задача не найдена"
      });
    }

    const ctx = await requireFamilyCapability({
      request,
      familyId: task.familyId,
      capability: "task.execute"
    });

    await ensureFamilyParticipant(payload.participantId, task.familyId);
    assertTaskExecutionPermission({
      ctx,
      participantId: payload.participantId,
      assignedParticipantIds: task.assignments
        .map((assignment) => assignment.executor.participantId)
        .filter((participantId): participantId is string => Boolean(participantId))
    });

    const actor = await getAuditActorSnapshot(request);

    const execution = await prisma.$transaction(async (tx) => {
      const created = await tx.taskExecution.create({
        data: {
          taskId,
          participantId: payload.participantId,
          actualDurationMinutes: payload.actualDurationMinutes,
          status: payload.status,
          note: payload.note
        }
      });

      const nextStatus = payload.status === "SKIPPED" ? "CANCELLED" : "DONE";
      const nextCompletedAt = payload.status === "SKIPPED" ? null : created.executedAt;

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: nextStatus,
          completedAt: nextCompletedAt
        }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: task.familyId,
        actorFamilyRole: ctx.role,
        action: "task.execute",
        entityType: "TaskExecution",
        entityId: `${created.taskId}:${created.participantId}:${created.executedAt.toISOString()}`,
        diff: {
          execution: created,
          taskBefore: { status: task.status, completedAt: task.completedAt },
          taskAfter: { status: nextStatus, completedAt: nextCompletedAt }
        }
      });

      await enqueueOutboxEvent(tx, {
        familyId: task.familyId,
        type: "task.search.sync",
        payload: {
          familyId: task.familyId,
          taskId
        }
      });

      return created;
    });

    await invalidateFamilyCache(task.familyId);
    return reply.code(201).send(execution);
  });
}
