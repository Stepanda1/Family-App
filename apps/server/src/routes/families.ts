import { Prisma, PlannerItemType, PlannerStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildOverviewResponse, toPlannerItemRecord, toPlannerItemSummary } from "../lib/serializers.js";
import { prisma } from "../lib/prisma.js";

const familyParamsSchema = z.object({
  familyId: z.string().uuid()
});

const bootstrapSchema = z.object({
  familyName: z.string().min(2).max(120),
  timezone: z.string().min(3).max(80).default("Asia/Yekaterinburg"),
  ownerName: z.string().min(2).max(80)
});

const familyUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  timezone: z.string().min(3).max(80).optional()
});

const preferencesUpdateSchema = z.object({
  appLanguage: z.enum(["ru", "en"])
});

const participantCreateSchema = z.object({
  displayName: z.string().min(2).max(80),
  role: z.enum(["PARENT", "CHILD"]),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
});

const participantUpdateSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  role: z.enum(["PARENT", "CHILD"]).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
});

const participantParamsSchema = z.object({
  participantId: z.string().uuid()
});

const executorCreateSchema = z.object({
  displayName: z.string().min(2).max(80),
  kind: z.enum(["FAMILY_MEMBER", "EXTERNAL_HELPER"])
});

const executorUpdateSchema = z.object({
  displayName: z.string().min(2).max(80).optional(),
  kind: z.enum(["EXTERNAL_HELPER"]).optional()
});

const executorParamsSchema = z.object({
  executorId: z.string().uuid()
});

const categoryCreateSchema = z.object({
  name: z.string().min(2).max(80),
  itemType: z.enum(["TASK", "EVENT", "SHOPPING"]),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
});

const categoryUpdateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  itemType: z.enum(["TASK", "EVENT", "SHOPPING"]).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
});

const categoryParamsSchema = z.object({
  categoryId: z.string().uuid()
});

const accountConnectionCreateSchema = z.object({
  provider: z.enum(["GOOGLE", "APPLE", "TELEGRAM"]),
  accountEmail: z.string().email(),
  displayName: z.string().min(2).max(80)
});

const accountConnectionUpdateSchema = z.object({
  provider: z.enum(["GOOGLE", "APPLE", "TELEGRAM"]).optional(),
  accountEmail: z.string().email().optional(),
  displayName: z.string().min(2).max(80).optional()
});

const accountConnectionParamsSchema = z.object({
  accountConnectionId: z.string().uuid()
});

function toFamilySummary(family: {
  id: string;
  name: string;
  timezone: string;
  inviteCode: string;
  appLanguage: "ru" | "en";
}) {
  return {
    id: family.id,
    name: family.name,
    timezone: family.timezone,
    inviteCode: family.inviteCode,
    appLanguage: family.appLanguage
  };
}

function toParticipantSummary(participant: {
  id: string;
  familyId: string;
  displayName: string;
  role: "PARENT" | "CHILD";
  color: string;
}) {
  return participant;
}

function toExecutorSummary(executor: {
  id: string;
  familyId: string;
  participantId: string | null;
  displayName: string;
  kind: "FAMILY_MEMBER" | "EXTERNAL_HELPER";
}) {
  return executor;
}

function toCategorySummary(category: {
  id: string;
  familyId: string;
  name: string;
  itemType: "TASK" | "EVENT" | "SHOPPING";
  color: string;
}) {
  return category;
}

function toAccountConnectionSummary(account: {
  id: string;
  familyId: string;
  provider: "GOOGLE" | "APPLE" | "TELEGRAM";
  accountEmail: string;
  displayName: string;
}) {
  return account;
}

export async function registerFamilyRoutes(app: FastifyInstance) {
  app.get("/api/families/:familyId", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      include: {
        participants: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!family) {
      return reply.code(404).send({ message: "Family not found" });
    }

    return family;
  });

  app.get("/api/families/:familyId/overview", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(23, 59, 59, 999);

    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: {
        id: true,
        name: true,
        timezone: true,
        inviteCode: true,
        appLanguage: true,
        participants: {
          select: {
            id: true,
            familyId: true,
            displayName: true,
            role: true,
            color: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!family) {
      return reply.code(404).send({ message: "Family not found" });
    }

    const [urgentItems, todayItems] = await Promise.all([
      prisma.task.findMany({
        where: {
          familyId,
          status: {
            in: [PlannerStatus.NEW, PlannerStatus.IN_PROGRESS]
          },
          OR: [{ dueAt: { lte: tomorrow } }, { priority: "HIGH" }]
        },
        include: {
          assignments: {
            include: {
              executor: {
                select: { displayName: true }
              }
            }
          }
        },
        orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
        take: 5
      }),
      prisma.task.findMany({
        where: {
          familyId,
          itemType: PlannerItemType.EVENT,
          scheduledStartAt: {
            gte: now,
            lte: tomorrow
          }
        },
        include: {
          assignments: {
            include: {
              executor: {
                select: { displayName: true }
              }
            }
          }
        },
        orderBy: { scheduledStartAt: "asc" },
        take: 5
      })
    ]);

    return buildOverviewResponse({
      family,
      participants: family.participants,
      urgentItems,
      todayItems
    });
  });

  app.get("/api/families/:familyId/settings", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      include: {
        participants: {
          orderBy: { createdAt: "asc" }
        },
        executors: {
          orderBy: { createdAt: "asc" }
        },
        categories: {
          orderBy: [{ itemType: "asc" }, { sortOrder: "asc" }, { name: "asc" }]
        }
      }
    });

    if (!family) {
      return reply.code(404).send({ message: "Family not found" });
    }

    return {
      family: toFamilySummary(family),
      participants: family.participants.map(toParticipantSummary),
      executors: family.executors.map(toExecutorSummary),
      categories: family.categories.map(toCategorySummary)
    };
  });

  app.get("/api/families/:familyId/preferences", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      include: {
        accountConnections: {
          orderBy: [{ provider: "asc" }, { createdAt: "asc" }]
        }
      }
    });

    if (!family) {
      return reply.code(404).send({ message: "Family not found" });
    }

    return {
      family: toFamilySummary(family),
      accountConnections: family.accountConnections.map(toAccountConnectionSummary)
    };
  });

  app.patch("/api/families/:familyId", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const payload = familyUpdateSchema.parse(request.body);

    const family = await prisma.family.update({
      where: { id: familyId },
      data: {
        name: payload.name,
        timezone: payload.timezone
      }
    });

    return toFamilySummary(family);
  });

  app.patch("/api/families/:familyId/preferences", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const payload = preferencesUpdateSchema.parse(request.body);

    const family = await prisma.family.update({
      where: { id: familyId },
      data: {
        appLanguage: payload.appLanguage
      }
    });

    return toFamilySummary(family);
  });

  app.get("/api/families/:familyId/database-snapshot", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      include: {
        participants: { orderBy: { createdAt: "asc" } },
        executors: { orderBy: { createdAt: "asc" } },
        categories: { orderBy: [{ itemType: "asc" }, { name: "asc" }] },
        accountConnections: { orderBy: [{ provider: "asc" }, { createdAt: "asc" }] },
        tasks: {
          include: {
            assignments: {
              include: {
                executor: {
                  select: { displayName: true }
                }
              }
            }
          },
          orderBy: [{ createdAt: "desc" }],
          take: 20
        }
      }
    });

    if (!family) {
      return reply.code(404).send({ message: "Family not found" });
    }

    return {
      family: toFamilySummary(family),
      participants: family.participants.map(toParticipantSummary),
      executors: family.executors.map(toExecutorSummary),
      categories: family.categories.map(toCategorySummary),
      accountConnections: family.accountConnections.map(toAccountConnectionSummary),
      tasks: family.tasks.map(toPlannerItemSummary)
    };
  });

  app.get("/api/families/:familyId/calendar", async (request) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const items = await prisma.task.findMany({
      where: {
        familyId,
        itemType: PlannerItemType.EVENT
      },
      include: {
        category: true,
        assignments: {
          include: {
            executor: true
          }
        }
      },
      orderBy: { scheduledStartAt: "asc" }
    });

    return items.map((item) => toPlannerItemRecord(item));
  });

  app.get("/api/families/:familyId/tasks", async (request) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const items = await prisma.task.findMany({
      where: {
        familyId,
        itemType: PlannerItemType.TASK
      },
      include: {
        assignments: {
          include: {
            executor: true
          }
        },
        category: true
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }]
    });

    return items.map((item) => toPlannerItemRecord(item));
  });

  app.get("/api/families/:familyId/shopping", async (request) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const items = await prisma.task.findMany({
      where: {
        familyId,
        itemType: PlannerItemType.SHOPPING
      },
      include: {
        assignments: {
          include: {
            executor: true
          }
        },
        category: true
      },
      orderBy: [{ listName: "asc" }, { createdAt: "asc" }]
    });

    return items.map((item) => toPlannerItemRecord(item));
  });

  app.post("/api/families/bootstrap", async (request, reply) => {
    const payload = bootstrapSchema.parse(request.body);
    const family = await prisma.family.create({
      data: {
        name: payload.familyName,
        timezone: payload.timezone,
        inviteCode: `FAM${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        participants: {
          create: {
            displayName: payload.ownerName,
            role: "PARENT",
            color: "#0EA5E9"
          }
        }
      },
      include: {
        participants: true
      }
    });

    await prisma.$transaction([
      prisma.executor.create({
        data: {
          familyId: family.id,
          participantId: family.participants[0].id,
          displayName: family.participants[0].displayName,
          kind: "FAMILY_MEMBER"
        }
      }),
      prisma.category.create({
        data: {
          familyId: family.id,
          name: "Дом",
          itemType: "TASK",
          color: "#22C55E"
        }
      }),
      prisma.category.create({
        data: {
          familyId: family.id,
          name: "События",
          itemType: "EVENT",
          color: "#0EA5E9"
        }
      }),
      prisma.category.create({
        data: {
          familyId: family.id,
          name: "Покупки",
          itemType: "SHOPPING",
          color: "#F97316"
        }
      })
    ]);

    return reply.code(201).send({
      family: toFamilySummary(family),
      owner: {
        id: family.participants[0].id,
        familyId: family.id,
        displayName: family.participants[0].displayName,
        role: family.participants[0].role,
        color: family.participants[0].color
      }
    });
  });

  app.post("/api/families/:familyId/participants", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const payload = participantCreateSchema.parse(request.body);

    let participant;
    try {
      participant = await prisma.participant.create({
        data: {
          familyId,
          displayName: payload.displayName,
          role: payload.role,
          color: payload.color
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Участник с таким именем уже есть в семье" });
      }

      throw error;
    }

    await prisma.executor.create({
      data: {
        familyId,
        participantId: participant.id,
        displayName: participant.displayName,
        kind: "FAMILY_MEMBER"
      }
    });

    return reply.code(201).send(toParticipantSummary(participant));
  });

  app.patch("/api/participants/:participantId", async (request, reply) => {
    const { participantId } = participantParamsSchema.parse(request.params);
    const payload = participantUpdateSchema.parse(request.body);

    let participant;
    try {
      participant = await prisma.participant.update({
        where: { id: participantId },
        data: {
          displayName: payload.displayName,
          role: payload.role,
          color: payload.color
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Участник с таким именем уже есть в семье" });
      }

      throw error;
    }

    if (payload.displayName) {
      await prisma.executor.updateMany({
        where: {
          participantId
        },
        data: {
          displayName: payload.displayName
        }
      });
    }

    return toParticipantSummary(participant);
  });

  app.delete("/api/participants/:participantId", async (request, reply) => {
    const { participantId } = participantParamsSchema.parse(request.params);

    const existing = await prisma.participant.findUnique({
      where: { id: participantId },
      include: {
        executor: true
      }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Participant not found" });
    }

    await prisma.$transaction(async (tx) => {
      if (existing.executor) {
        await tx.assignment.deleteMany({
          where: { executorId: existing.executor.id }
        });

        await tx.executor.delete({
          where: { id: existing.executor.id }
        });
      }

      await tx.taskExecution.deleteMany({
        where: { participantId }
      });

      await tx.task.deleteMany({
        where: { creatorParticipantId: participantId }
      });

      await tx.participant.delete({
        where: { id: participantId }
      });
    });

    return reply.code(204).send();
  });

  app.post("/api/families/:familyId/executors", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const payload = executorCreateSchema.parse(request.body);

    const executor = await prisma.executor.create({
      data: {
        familyId,
        participantId: null,
        displayName: payload.displayName,
        kind: payload.kind
      }
    });

    return reply.code(201).send(toExecutorSummary(executor));
  });

  app.patch("/api/executors/:executorId", async (request, reply) => {
    const { executorId } = executorParamsSchema.parse(request.params);
    const payload = executorUpdateSchema.parse(request.body);

    const existing = await prisma.executor.findUnique({
      where: { id: executorId }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Executor not found" });
    }

    if (existing.kind === "FAMILY_MEMBER") {
      return reply.code(409).send({ message: "Исполнители, связанные с участниками, меняются через раздел участников" });
    }

    const executor = await prisma.executor.update({
      where: { id: executorId },
      data: {
        displayName: payload.displayName,
        kind: payload.kind
      }
    });

    return toExecutorSummary(executor);
  });

  app.delete("/api/executors/:executorId", async (request, reply) => {
    const { executorId } = executorParamsSchema.parse(request.params);

    const existing = await prisma.executor.findUnique({
      where: { id: executorId }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Executor not found" });
    }

    if (existing.kind === "FAMILY_MEMBER") {
      return reply.code(409).send({ message: "Исполнители, связанные с участниками, удаляются через раздел участников" });
    }

    await prisma.assignment.deleteMany({
      where: { executorId }
    });

    await prisma.executor.delete({
      where: { id: executorId }
    });

    return reply.code(204).send();
  });

  app.post("/api/families/:familyId/categories", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const payload = categoryCreateSchema.parse(request.body);

    const maxSortOrder = await prisma.category.aggregate({
      where: { familyId, itemType: payload.itemType },
      _max: { sortOrder: true }
    });

    let category;
    try {
      category = await prisma.category.create({
        data: {
          familyId,
          name: payload.name,
          itemType: payload.itemType,
          color: payload.color,
          sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Категория с таким именем уже существует для этого типа" });
      }

      throw error;
    }

    return reply.code(201).send(toCategorySummary(category));
  });

  app.patch("/api/categories/:categoryId", async (request, reply) => {
    const { categoryId } = categoryParamsSchema.parse(request.params);
    const payload = categoryUpdateSchema.parse(request.body);

    let category;
    try {
      category = await prisma.category.update({
        where: { id: categoryId },
        data: {
          name: payload.name,
          itemType: payload.itemType,
          color: payload.color
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Категория с таким именем уже существует для этого типа" });
      }

      throw error;
    }

    return toCategorySummary(category);
  });

  app.delete("/api/categories/:categoryId", async (request, reply) => {
    const { categoryId } = categoryParamsSchema.parse(request.params);

    try {
      await prisma.category.delete({
        where: { id: categoryId }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return reply.code(409).send({ message: "Категория используется в задачах и не может быть удалена" });
      }

      throw error;
    }

    return reply.code(204).send();
  });

  app.post("/api/families/:familyId/account-connections", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const payload = accountConnectionCreateSchema.parse(request.body);

    let accountConnection;
    try {
      accountConnection = await prisma.accountConnection.create({
        data: {
          familyId,
          provider: payload.provider,
          accountEmail: payload.accountEmail,
          displayName: payload.displayName
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Такой аккаунт уже подключён к семье" });
      }

      throw error;
    }

    return reply.code(201).send(toAccountConnectionSummary(accountConnection));
  });

  app.patch("/api/account-connections/:accountConnectionId", async (request, reply) => {
    const { accountConnectionId } = accountConnectionParamsSchema.parse(request.params);
    const payload = accountConnectionUpdateSchema.parse(request.body);

    let accountConnection;
    try {
      accountConnection = await prisma.accountConnection.update({
        where: { id: accountConnectionId },
        data: {
          provider: payload.provider,
          accountEmail: payload.accountEmail,
          displayName: payload.displayName
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Такой аккаунт уже подключён к семье" });
      }

      throw error;
    }

    return toAccountConnectionSummary(accountConnection);
  });

  app.delete("/api/account-connections/:accountConnectionId", async (request, reply) => {
    const { accountConnectionId } = accountConnectionParamsSchema.parse(request.params);

    await prisma.accountConnection.delete({
      where: { id: accountConnectionId }
    });

    return reply.code(204).send();
  });
}
