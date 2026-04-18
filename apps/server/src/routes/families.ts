import { Prisma, PlannerItemType, PlannerStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildOverviewResponse, toPlannerItemRecord, toPlannerItemSummary } from "../lib/serializers.js";
import { prisma } from "../lib/prisma.js";
import type { FamilyCapability } from "../lib/authz/family-access.js";
import { requireFamilyAccess, requireFamilyCapability } from "../lib/authz/family-access.js";
import { AppError } from "../lib/http/problem.js";
import { getAuditActorSnapshot, logAuditEvent } from "../lib/audit/audit.js";
import {
  invalidateFamilyCache,
  invalidateUserCache,
  readThroughScopedJsonCache
} from "../lib/cache/store.js";
import { executeIdempotent } from "../lib/http/idempotency.js";
import { enqueueOutboxEvent } from "../lib/outbox/outbox.js";

const familyParamsSchema = z.object({
  familyId: z.string().uuid()
});

const bootstrapSchema = z.object({
  familyName: z.string().min(2).max(120),
  timezone: z.string().min(3).max(80).default("Asia/Yekaterinburg"),
  ownerName: z.string().min(2).max(80)
});

const joinFamilySchema = z.object({
  inviteCode: z.string().min(4).max(12),
  role: z.enum(["PARENT", "CHILD", "GUEST"]),
  displayName: z.string().min(2).max(80).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
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

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  actorSessionId: z.string().uuid().optional(),
  action: z.string().min(1).max(80).optional(),
  entityType: z.string().min(1).max(80).optional(),
  entityId: z.string().min(1).max(100).optional(),
  correlationId: z.string().min(1).max(64).optional(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/i).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

const CACHE_TTL_SECONDS = {
  myFamilies: 60,
  overview: 30,
  settings: 60,
  planner: 30
} as const;

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

export async function registerFamilyRoutes(
  app: FastifyInstance<any, any, any, any>
) {
  async function invalidateFamilyReadCaches(familyId: string) {
    const memberships = await prisma.familyMembership.findMany({
      where: { familyId },
      select: { userId: true }
    });

    const uniqueUserIds = [...new Set(memberships.map((membership) => membership.userId))];
    await Promise.all([
      invalidateFamilyCache(familyId),
      ...uniqueUserIds.map((userId) => invalidateUserCache(userId))
    ]);
  }

  async function requireCtx(
    request: any,
    familyId: string,
    capability?: FamilyCapability
  ) {
    if (capability) {
      return requireFamilyCapability({ request, familyId, capability });
    }

    const ctx = await requireFamilyAccess({ request, familyId });
    if (!ctx) {
      throw new AppError({
        status: 403,
        code: "FAMILY_ACCESS_DENIED",
        detail: "Пользователь не состоит в этой семье"
      });
    }

    return ctx;
  }

  app.get("/api/my/families", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;

    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "user", id: userId }],
      keyParts: ["my-families"],
      ttlSeconds: CACHE_TTL_SECONDS.myFamilies,
      loader: async () => {
        const memberships = await prisma.familyMembership.findMany({
          where: { userId },
          orderBy: { createdAt: "asc" },
          include: {
            family: { select: { id: true, name: true, timezone: true, inviteCode: true, appLanguage: true } },
            participant: {
              select: { id: true, familyId: true, displayName: true, role: true, color: true }
            }
          }
        });

        return {
          families: memberships.map((membership) => ({
            family: toFamilySummary(membership.family),
            role: membership.role,
            participant: membership.participant ?? null
          }))
        };
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });

  app.post("/api/families/join", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const payload = joinFamilySchema.parse(request.body);

    const family = await prisma.family.findUnique({
      where: { inviteCode: payload.inviteCode.toUpperCase() },
      select: { id: true }
    });

    if (!family) {
      return reply.code(404).send({ message: "Family not found" });
    }

    const existing = await prisma.familyMembership.findUnique({
      where: { familyId_userId: { familyId: family.id, userId } }
    });
    if (existing) {
      return reply.code(409).send({ message: "Already joined" });
    }

    const isGuest = payload.role === "GUEST";
    const actor = await getAuditActorSnapshot(request);

    await executeIdempotent({
      request,
      reply,
      operation: "family.join",
      body: payload,
      statusCode: 204,
      handler: async () => {
        await prisma.$transaction(async (tx) => {
          const participant = isGuest
            ? null
            : await tx.participant.create({
                data: {
                  familyId: family.id,
                  displayName: payload.displayName ?? "Участник",
                  role: payload.role === "PARENT" ? "PARENT" : "CHILD",
                  color: payload.color ?? "#64748B"
                }
              });

          if (participant) {
            await tx.executor.create({
              data: {
                familyId: family.id,
                participantId: participant.id,
                displayName: participant.displayName,
                kind: "FAMILY_MEMBER"
              }
            });
          }

          const membership = await tx.familyMembership.create({
            data: {
              familyId: family.id,
              userId,
              role: isGuest
                ? "GUEST"
                : payload.role === "PARENT"
                  ? "PARENT"
                  : "CHILD",
              participantId: participant?.id ?? undefined
            },
            select: {
              id: true,
              role: true,
              participantId: true,
              familyId: true,
              userId: true
            }
          });

          await logAuditEvent(tx, {
            request,
            actor,
            familyId: family.id,
            actorFamilyRole: membership.role,
            action: "family.join",
            entityType: "FamilyMembership",
            entityId: membership.id,
            diff: {
              membership,
              participant: participant
                ? {
                    id: participant.id,
                    displayName: participant.displayName,
                    role: participant.role,
                    color: participant.color
                  }
                : null
            }
          });

          if (actor.email) {
            await enqueueOutboxEvent(tx, {
              familyId: family.id,
              type: "email.send",
              payload: {
                toEmail: actor.email,
                subject: "Вы присоединились к семье",
                body: `FamilyId: ${family.id}\nRole: ${membership.role}\nParticipantId: ${membership.participantId ?? ""}`
              },
              maxAttempts: 10
            });
          }
        });

        return null;
      }
    });

    await invalidateFamilyReadCaches(family.id);
    return reply.code(204).send();
  });

  app.get("/api/families/:familyId", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId);
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
    const ctx = await requireCtx(request, familyId);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(23, 59, 59, 999);

    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "family", id: familyId }],
      keyParts: [
        "family-overview",
        ctx.userId,
        ctx.role,
        now.toISOString().slice(0, 16),
        tomorrow.toISOString().slice(0, 16)
      ],
      ttlSeconds: CACHE_TTL_SECONDS.overview,
      loader: async () => {
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
          throw new AppError({
            status: 404,
            code: "FAMILY_NOT_FOUND",
            detail: "Family not found"
          });
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
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });

  app.get("/api/families/:familyId/settings", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId);
    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "family", id: familyId }],
      keyParts: ["family-settings", ctx.userId, ctx.role],
      ttlSeconds: CACHE_TTL_SECONDS.settings,
      loader: async () => {
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
          throw new AppError({
            status: 404,
            code: "FAMILY_NOT_FOUND",
            detail: "Family not found"
          });
        }

        return {
          family: toFamilySummary(family),
          participants: family.participants.map(toParticipantSummary),
          executors: family.executors.map(toExecutorSummary),
          categories: family.categories.map(toCategorySummary)
        };
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });

  app.get("/api/families/:familyId/audit", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "family.members.manage");

    const query = auditQuerySchema.parse(request.query);
    const cursorEvent = query.cursor
      ? await prisma.auditEvent.findUnique({
          where: { id: query.cursor },
          select: { id: true, familyId: true, createdAt: true }
        })
      : null;

    if (query.cursor && (!cursorEvent || cursorEvent.familyId !== familyId)) {
      return reply.code(404).send({ message: "Cursor not found" });
    }

    const cursorWhere = cursorEvent
      ? {
          OR: [{ createdAt: { lt: cursorEvent.createdAt } }, { createdAt: cursorEvent.createdAt, id: { lt: cursorEvent.id } }]
        }
      : {};

    const events = await prisma.auditEvent.findMany({
      where: {
        familyId,
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.actorSessionId ? { actorSessionId: query.actorSessionId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.correlationId ? { correlationId: query.correlationId } : {}),
        ...(query.traceId ? { traceId: query.traceId.toLowerCase() } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {})
              }
            }
          : {}),
        ...cursorWhere
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
      select: {
        id: true,
        createdAt: true,
        actorUserId: true,
        actorFamilyRole: true,
        actorEmail: true,
        actorDisplayName: true,
        action: true,
        entityType: true,
        entityId: true,
        diff: true,
        correlationId: true,
        traceId: true,
        spanId: true,
        actorSessionId: true,
        metadata: true,
        ipAddress: true,
        userAgent: true
      }
    });

    return reply.send({
      items: events,
      nextCursor: events.length ? events[events.length - 1].id : null
    });
  });

  app.get("/api/families/:familyId/preferences", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "family.manage");
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
    const ctx = await requireCtx(request, familyId, "family.manage");
    const payload = familyUpdateSchema.parse(request.body);

    const actor = await getAuditActorSnapshot(request);

    const family = await prisma.$transaction(async (tx) => {
      const before = await tx.family.findUnique({
        where: { id: familyId },
        select: { id: true, name: true, timezone: true, inviteCode: true, appLanguage: true }
      });

      const updated = await tx.family.update({
        where: { id: familyId },
        data: {
          name: payload.name,
          timezone: payload.timezone
        }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId,
        actorFamilyRole: ctx.role,
        action: "family.update",
        entityType: "Family",
        entityId: familyId,
        diff: { before, after: toFamilySummary(updated) }
      });

      return updated;
    });

    await invalidateFamilyReadCaches(familyId);
    return toFamilySummary(family);
  });

  app.patch("/api/families/:familyId/preferences", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "family.manage");
    const payload = preferencesUpdateSchema.parse(request.body);

    const actor = await getAuditActorSnapshot(request);

    const family = await prisma.$transaction(async (tx) => {
      const before = await tx.family.findUnique({
        where: { id: familyId },
        select: { id: true, name: true, timezone: true, inviteCode: true, appLanguage: true }
      });

      const updated = await tx.family.update({
        where: { id: familyId },
        data: {
          appLanguage: payload.appLanguage
        }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId,
        actorFamilyRole: ctx.role,
        action: "family.preferences.update",
        entityType: "Family",
        entityId: familyId,
        diff: { before, after: toFamilySummary(updated) }
      });

      return updated;
    });

    await invalidateFamilyReadCaches(familyId);
    return toFamilySummary(family);
  });

  app.get("/api/families/:familyId/database-snapshot", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "family.members.manage");
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

  app.get("/api/families/:familyId/calendar", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId);
    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "family", id: familyId }],
      keyParts: ["planner-calendar", ctx.userId, ctx.role],
      ttlSeconds: CACHE_TTL_SECONDS.planner,
      loader: async () => {
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
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });

  app.get("/api/families/:familyId/tasks", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId);
    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "family", id: familyId }],
      keyParts: ["planner-tasks", ctx.userId, ctx.role],
      ttlSeconds: CACHE_TTL_SECONDS.planner,
      loader: async () => {
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
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });

  app.get("/api/families/:familyId/shopping", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId);
    const { value, cacheStatus } = await readThroughScopedJsonCache({
      scopes: [{ kind: "family", id: familyId }],
      keyParts: ["planner-shopping", ctx.userId, ctx.role],
      ttlSeconds: CACHE_TTL_SECONDS.planner,
      loader: async () => {
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
      }
    });

    reply.header("x-cache", cacheStatus);
    return reply.send(value);
  });

  app.post("/api/families/bootstrap", async (request, reply) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const payload = bootstrapSchema.parse(request.body);

    const actor = await getAuditActorSnapshot(request);

    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({
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

      await tx.executor.create({
        data: {
          familyId: created.id,
          participantId: created.participants[0].id,
          displayName: created.participants[0].displayName,
          kind: "FAMILY_MEMBER"
        }
      });

      await tx.familyMembership.create({
        data: {
          familyId: created.id,
          userId,
          role: "OWNER",
          participantId: created.participants[0].id
        }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: created.id,
        actorFamilyRole: "OWNER",
        action: "family.bootstrap",
        entityType: "Family",
        entityId: created.id,
        diff: {
          family: toFamilySummary(created),
          ownerParticipant: {
            id: created.participants[0].id,
            displayName: created.participants[0].displayName,
            role: created.participants[0].role,
            color: created.participants[0].color
          }
        }
      });

      await tx.category.create({
        data: {
          familyId: created.id,
          name: "Дом",
          itemType: "TASK",
          color: "#22C55E"
        }
      });
      await tx.category.create({
        data: {
          familyId: created.id,
          name: "События",
          itemType: "EVENT",
          color: "#0EA5E9"
        }
      });
      await tx.category.create({
        data: {
          familyId: created.id,
          name: "Покупки",
          itemType: "SHOPPING",
          color: "#F97316"
        }
      });

      if (actor.email) {
        await enqueueOutboxEvent(tx, {
          familyId: created.id,
          type: "email.send",
          payload: {
            toEmail: actor.email,
            subject: `Создана семья: ${created.name}`,
            body: `FamilyId: ${created.id}\nInviteCode: ${created.inviteCode}\nTimezone: ${created.timezone}`
          },
          maxAttempts: 10
        });
      }

      return created;
    });

    await invalidateFamilyReadCaches(family.id);
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
    const ctx = await requireCtx(request, familyId, "family.members.manage");
    const payload = participantCreateSchema.parse(request.body);
    const actor = await getAuditActorSnapshot(request);

    let participant;
    try {
      participant = await prisma.$transaction(async (tx) => {
        const created = await tx.participant.create({
          data: {
            familyId,
            displayName: payload.displayName,
            role: payload.role,
            color: payload.color
          }
        });

        await tx.executor.create({
          data: {
            familyId,
            participantId: created.id,
            displayName: created.displayName,
            kind: "FAMILY_MEMBER"
          }
        });

        await logAuditEvent(tx, {
          request,
          actor,
          familyId,
          actorFamilyRole: ctx.role,
          action: "participant.create",
          entityType: "Participant",
          entityId: created.id,
          diff: { after: toParticipantSummary(created) }
        });

        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Участник с таким именем уже есть в семье" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(familyId);
    return reply.code(201).send(toParticipantSummary(participant));
  });

  app.patch("/api/participants/:participantId", async (request, reply) => {
    const { participantId } = participantParamsSchema.parse(request.params);
    const payload = participantUpdateSchema.parse(request.body);

    const existing = await prisma.participant.findUnique({
      where: { id: participantId },
      select: { familyId: true }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Participant not found" });
    }

    const ctx = await requireCtx(request, existing.familyId, "family.members.manage");

    const actor = await getAuditActorSnapshot(request);

    let participant;
    try {
      participant = await prisma.$transaction(async (tx) => {
        const before = await tx.participant.findUnique({
          where: { id: participantId },
          select: { id: true, familyId: true, displayName: true, role: true, color: true }
        });

        const updated = await tx.participant.update({
          where: { id: participantId },
          data: {
            displayName: payload.displayName,
            role: payload.role,
            color: payload.color
          }
        });

        if (payload.displayName) {
          await tx.executor.updateMany({
            where: {
              participantId
            },
            data: {
              displayName: payload.displayName
            }
          });
        }

        await logAuditEvent(tx, {
          request,
          actor,
          familyId: existing.familyId,
          actorFamilyRole: ctx.role,
          action: "participant.update",
          entityType: "Participant",
          entityId: participantId,
          diff: { before, after: toParticipantSummary(updated) }
        });

        await enqueueOutboxEvent(tx, {
          familyId: existing.familyId,
          type: "task.search.reindex_family",
          payload: { familyId: existing.familyId }
        });

        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Участник с таким именем уже есть в семье" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(existing.familyId);
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

    const ctx = await requireCtx(request, existing.familyId, "family.members.manage");

    const actor = await getAuditActorSnapshot(request);

    await prisma.$transaction(async (tx) => {
      const [tasksCreatedCount, executionsCount, assignmentsCount] = await Promise.all([
        tx.task.count({ where: { creatorParticipantId: participantId } }),
        tx.taskExecution.count({ where: { participantId } }),
        existing.executor ? tx.assignment.count({ where: { executorId: existing.executor.id } }) : Promise.resolve(0)
      ]);

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

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: existing.familyId,
        actorFamilyRole: ctx.role,
        action: "participant.delete",
        entityType: "Participant",
        entityId: participantId,
        diff: {
          before: toParticipantSummary(existing),
          deleted: {
            tasksCreatedCount,
            executionsCount,
            assignmentsCount,
            hadExecutor: Boolean(existing.executor)
          }
        }
      });

      await enqueueOutboxEvent(tx, {
        familyId: existing.familyId,
        type: "task.search.reindex_family",
        payload: { familyId: existing.familyId }
      });
    });

    await invalidateFamilyReadCaches(existing.familyId);
    return reply.code(204).send();
  });

  app.post("/api/families/:familyId/executors", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "planner.write");
    const payload = executorCreateSchema.parse(request.body);

    const actor = await getAuditActorSnapshot(request);

    const executor = await prisma.$transaction(async (tx) => {
      const created = await tx.executor.create({
        data: {
          familyId,
          participantId: null,
          displayName: payload.displayName,
          kind: payload.kind
        }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId,
        actorFamilyRole: ctx.role,
        action: "executor.create",
        entityType: "Executor",
        entityId: created.id,
        diff: { after: toExecutorSummary(created) }
      });

      return created;
    });

    await invalidateFamilyReadCaches(familyId);
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

    const ctx = await requireCtx(request, existing.familyId, "planner.write");

    if (existing.kind === "FAMILY_MEMBER") {
      return reply.code(409).send({ message: "Исполнители, связанные с участниками, меняются через раздел участников" });
    }

    const actor = await getAuditActorSnapshot(request);

    const executor = await prisma.$transaction(async (tx) => {
      const before = await tx.executor.findUnique({
        where: { id: executorId },
        select: { id: true, familyId: true, participantId: true, displayName: true, kind: true, contactInfo: true }
      });

      const updated = await tx.executor.update({
        where: { id: executorId },
        data: {
          displayName: payload.displayName,
          kind: payload.kind
        }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: existing.familyId,
        actorFamilyRole: ctx.role,
        action: "executor.update",
        entityType: "Executor",
        entityId: executorId,
        diff: { before, after: toExecutorSummary(updated) }
      });

      await enqueueOutboxEvent(tx, {
        familyId: existing.familyId,
        type: "task.search.reindex_family",
        payload: { familyId: existing.familyId }
      });

      return updated;
    });

    await invalidateFamilyReadCaches(existing.familyId);
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

    const ctx = await requireCtx(request, existing.familyId, "planner.write");

    if (existing.kind === "FAMILY_MEMBER") {
      return reply.code(409).send({ message: "Исполнители, связанные с участниками, удаляются через раздел участников" });
    }

    const actor = await getAuditActorSnapshot(request);

    await prisma.$transaction(async (tx) => {
      const assignmentsCount = await tx.assignment.count({ where: { executorId } });

      await tx.assignment.deleteMany({
        where: { executorId }
      });

      await tx.executor.delete({
        where: { id: executorId }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: existing.familyId,
        actorFamilyRole: ctx.role,
        action: "executor.delete",
        entityType: "Executor",
        entityId: executorId,
        diff: {
          before: toExecutorSummary(existing),
          deleted: { assignmentsCount }
        }
      });

      await enqueueOutboxEvent(tx, {
        familyId: existing.familyId,
        type: "task.search.reindex_family",
        payload: { familyId: existing.familyId }
      });
    });

    await invalidateFamilyReadCaches(existing.familyId);
    return reply.code(204).send();
  });

  app.post("/api/families/:familyId/categories", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "planner.write");
    const payload = categoryCreateSchema.parse(request.body);
    const actor = await getAuditActorSnapshot(request);

    let category;
    try {
      category = await prisma.$transaction(async (tx) => {
        const maxSortOrder = await tx.category.aggregate({
          where: { familyId, itemType: payload.itemType },
          _max: { sortOrder: true }
        });

        const created = await tx.category.create({
          data: {
            familyId,
            name: payload.name,
            itemType: payload.itemType,
            color: payload.color,
            sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1
          }
        });

        await logAuditEvent(tx, {
          request,
          actor,
          familyId,
          actorFamilyRole: ctx.role,
          action: "category.create",
          entityType: "Category",
          entityId: created.id,
          diff: { after: toCategorySummary(created) }
        });

        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Категория с таким именем уже существует для этого типа" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(familyId);
    return reply.code(201).send(toCategorySummary(category));
  });

  app.patch("/api/categories/:categoryId", async (request, reply) => {
    const { categoryId } = categoryParamsSchema.parse(request.params);
    const payload = categoryUpdateSchema.parse(request.body);

    const existing = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { familyId: true }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Category not found" });
    }

    const ctx = await requireCtx(request, existing.familyId, "planner.write");

    const actor = await getAuditActorSnapshot(request);

    let category;
    try {
      category = await prisma.$transaction(async (tx) => {
        const before = await tx.category.findUnique({
          where: { id: categoryId },
          select: { id: true, familyId: true, name: true, itemType: true, color: true, sortOrder: true }
        });

        const updated = await tx.category.update({
          where: { id: categoryId },
          data: {
            name: payload.name,
            itemType: payload.itemType,
            color: payload.color
          }
        });

        await logAuditEvent(tx, {
          request,
          actor,
          familyId: existing.familyId,
          actorFamilyRole: ctx.role,
          action: "category.update",
          entityType: "Category",
          entityId: categoryId,
          diff: { before, after: toCategorySummary(updated) }
        });

        await enqueueOutboxEvent(tx, {
          familyId: existing.familyId,
          type: "task.search.reindex_family",
          payload: { familyId: existing.familyId }
        });

        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Категория с таким именем уже существует для этого типа" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(existing.familyId);
    return toCategorySummary(category);
  });

  app.delete("/api/categories/:categoryId", async (request, reply) => {
    const { categoryId } = categoryParamsSchema.parse(request.params);

    const existing = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, familyId: true, name: true, itemType: true, color: true, sortOrder: true }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Category not found" });
    }

    const ctx = await requireCtx(request, existing.familyId, "planner.write");

    const actor = await getAuditActorSnapshot(request);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.category.delete({
          where: { id: categoryId }
        });

        await logAuditEvent(tx, {
          request,
          actor,
          familyId: existing.familyId,
          actorFamilyRole: ctx.role,
          action: "category.delete",
          entityType: "Category",
          entityId: categoryId,
          diff: { before: toCategorySummary(existing) }
        });

        await enqueueOutboxEvent(tx, {
          familyId: existing.familyId,
          type: "task.search.reindex_family",
          payload: { familyId: existing.familyId }
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        return reply.code(409).send({ message: "Категория используется в задачах и не может быть удалена" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(existing.familyId);
    return reply.code(204).send();
  });

  app.post("/api/families/:familyId/account-connections", async (request, reply) => {
    const { familyId } = familyParamsSchema.parse(request.params);
    const ctx = await requireCtx(request, familyId, "family.manage");
    const payload = accountConnectionCreateSchema.parse(request.body);
    const actor = await getAuditActorSnapshot(request);

    let accountConnection;
    try {
      accountConnection = await prisma.$transaction(async (tx) => {
        const created = await tx.accountConnection.create({
          data: {
            familyId,
            provider: payload.provider,
            accountEmail: payload.accountEmail,
            displayName: payload.displayName
          }
        });

        await logAuditEvent(tx, {
          request,
          actor,
          familyId,
          actorFamilyRole: ctx.role,
          action: "account_connection.create",
          entityType: "AccountConnection",
          entityId: created.id,
          diff: { after: toAccountConnectionSummary(created) }
        });

        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Такой аккаунт уже подключён к семье" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(familyId);
    return reply.code(201).send(toAccountConnectionSummary(accountConnection));
  });

  app.patch("/api/account-connections/:accountConnectionId", async (request, reply) => {
    const { accountConnectionId } = accountConnectionParamsSchema.parse(request.params);
    const payload = accountConnectionUpdateSchema.parse(request.body);

    const existing = await prisma.accountConnection.findUnique({
      where: { id: accountConnectionId },
      select: { familyId: true }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Account connection not found" });
    }

    const ctx = await requireCtx(request, existing.familyId, "family.manage");

    const actor = await getAuditActorSnapshot(request);

    let accountConnection;
    try {
      accountConnection = await prisma.$transaction(async (tx) => {
        const before = await tx.accountConnection.findUnique({
          where: { id: accountConnectionId },
          select: { id: true, familyId: true, provider: true, accountEmail: true, displayName: true }
        });

        const updated = await tx.accountConnection.update({
          where: { id: accountConnectionId },
          data: {
            provider: payload.provider,
            accountEmail: payload.accountEmail,
            displayName: payload.displayName
          }
        });

        await logAuditEvent(tx, {
          request,
          actor,
          familyId: existing.familyId,
          actorFamilyRole: ctx.role,
          action: "account_connection.update",
          entityType: "AccountConnection",
          entityId: accountConnectionId,
          diff: { before, after: toAccountConnectionSummary(updated) }
        });

        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "Такой аккаунт уже подключён к семье" });
      }

      throw error;
    }

    await invalidateFamilyReadCaches(existing.familyId);
    return toAccountConnectionSummary(accountConnection);
  });

  app.delete("/api/account-connections/:accountConnectionId", async (request, reply) => {
    const { accountConnectionId } = accountConnectionParamsSchema.parse(request.params);

    const existing = await prisma.accountConnection.findUnique({
      where: { id: accountConnectionId },
      select: { familyId: true }
    });

    if (!existing) {
      return reply.code(404).send({ message: "Account connection not found" });
    }

    const ctx = await requireCtx(request, existing.familyId, "family.manage");

    const actor = await getAuditActorSnapshot(request);

    const before = await prisma.accountConnection.findUnique({
      where: { id: accountConnectionId },
      select: { id: true, familyId: true, provider: true, accountEmail: true, displayName: true }
    });

    await prisma.$transaction(async (tx) => {
      await tx.accountConnection.delete({
        where: { id: accountConnectionId }
      });

      await logAuditEvent(tx, {
        request,
        actor,
        familyId: existing.familyId,
        actorFamilyRole: ctx.role,
        action: "account_connection.delete",
        entityType: "AccountConnection",
        entityId: accountConnectionId,
        diff: { before: before ? toAccountConnectionSummary(before) : null }
      });
    });

    await invalidateFamilyReadCaches(existing.familyId);
    return reply.code(204).send();
  });
}
