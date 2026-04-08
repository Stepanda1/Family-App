import { PlannerItemType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
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

export async function registerTaskRoutes(app: FastifyInstance) {
  app.post("/api/tasks", async (request, reply) => {
    const payload = createTaskSchema.parse(request.body);

    const created = await prisma.task.create({
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
        scheduledStartAt: payload.scheduledStartAt ? new Date(payload.scheduledStartAt) : undefined,
        dueAt: payload.dueAt ? new Date(payload.dueAt) : undefined,
        reminderAt: payload.reminderAt ? new Date(payload.reminderAt) : undefined,
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

    return reply.code(201).send(toPlannerItemRecord(created));
  });

  app.patch("/api/tasks/:taskId", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const payload = updateTaskSchema.parse(request.body);

    const existing = await prisma.task.findUnique({
      where: { id: taskId }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Task not found" });
    }

    await prisma.$transaction(async (tx) => {
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
    });

    const updated = await prisma.task.findUnique({
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

    return reply.send(updated ? toPlannerItemRecord(updated) : null);
  });

  app.delete("/api/tasks/:taskId", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Task not found" });
    }

    await prisma.task.delete({
      where: { id: taskId }
    });

    return reply.code(204).send();
  });

  app.post("/api/tasks/:taskId/executions", async (request, reply) => {
    const { taskId } = taskParamsSchema.parse(request.params);
    const payload = executionSchema.parse(request.body);

    const execution = await prisma.taskExecution.create({
      data: {
        taskId,
        participantId: payload.participantId,
        actualDurationMinutes: payload.actualDurationMinutes,
        status: payload.status,
        note: payload.note
      }
    });

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: payload.status === "SKIPPED" ? "CANCELLED" : "DONE",
        completedAt: payload.status === "SKIPPED" ? null : execution.executedAt
      }
    });

    return reply.code(201).send(execution);
  });
}
