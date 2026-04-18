import type { Executor, FamilyAccessRole, Participant } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AppError } from "../http/problem.js";
import { prisma } from "../prisma.js";

export type FamilyAuthContext = {
  familyId: string;
  userId: string;
  role: FamilyAccessRole;
  participant: Participant | null;
};

export type FamilyCapability =
  | "family.read"
  | "family.manage"
  | "family.members.manage"
  | "planner.read"
  | "planner.write"
  | "task.execute";

const ROLE_CAPABILITIES: Record<FamilyAccessRole, readonly FamilyCapability[]> = {
  OWNER: ["family.read", "family.manage", "family.members.manage", "planner.read", "planner.write", "task.execute"],
  PARENT: ["family.read", "family.members.manage", "planner.read", "planner.write", "task.execute"],
  CHILD: ["family.read", "planner.read", "task.execute"],
  GUEST: ["family.read", "planner.read"]
};

export function hasFamilyCapability(role: FamilyAccessRole, capability: FamilyCapability) {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function canManageFamily(role: FamilyAccessRole) {
  return hasFamilyCapability(role, "family.manage");
}

export function canManageMembers(role: FamilyAccessRole) {
  return hasFamilyCapability(role, "family.members.manage");
}

export function canWritePlanner(role: FamilyAccessRole) {
  return hasFamilyCapability(role, "planner.write");
}

export function canExecuteTasks(role: FamilyAccessRole) {
  return hasFamilyCapability(role, "task.execute");
}

export async function requireFamilyAccess(params: { request: FastifyRequest; familyId: string }) {
  await params.request.jwtVerify();
  const userId = params.request.user.sub;

  const membership = await prisma.familyMembership.findUnique({
    where: { familyId_userId: { familyId: params.familyId, userId } },
    include: { participant: true }
  });

  if (!membership) {
    return null;
  }

  return {
    familyId: membership.familyId,
    userId: membership.userId,
    role: membership.role,
    participant: membership.participant
  } satisfies FamilyAuthContext;
}

export function assertFamilyCapability(ctx: FamilyAuthContext, capability: FamilyCapability) {
  if (!hasFamilyCapability(ctx.role, capability)) {
    throw new AppError({
      status: 403,
      code: "FORBIDDEN",
      detail: "Недостаточно прав для этой операции"
    });
  }
}

export async function requireFamilyCapability(params: {
  request: FastifyRequest;
  familyId: string;
  capability: FamilyCapability;
}) {
  const ctx = await requireFamilyAccess({
    request: params.request,
    familyId: params.familyId
  });

  if (!ctx) {
    throw new AppError({
      status: 403,
      code: "FAMILY_ACCESS_DENIED",
      detail: "Пользователь не состоит в этой семье"
    });
  }

  assertFamilyCapability(ctx, params.capability);
  return ctx;
}

type FamilyScopedEntity = {
  id: string;
  familyId: string;
};

function assertEntityInFamily<T extends FamilyScopedEntity>(
  entity: T | null,
  familyId: string,
  code: string,
  message: string
) {
  if (!entity || entity.familyId !== familyId) {
    throw new AppError({
      status: 400,
      code,
      detail: message
    });
  }

  return entity;
}

export async function ensureFamilyParticipant(
  participantId: string,
  familyId: string,
  fieldName = "participantId"
) {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      familyId: true,
      displayName: true,
      role: true,
      color: true
    }
  });

  return assertEntityInFamily(
    participant,
    familyId,
    "INVALID_FAMILY_PARTICIPANT",
    `Поле ${fieldName} должно ссылаться на участника этой семьи`
  );
}

export async function ensureFamilyCategory(
  categoryId: string,
  familyId: string,
  fieldName = "categoryId"
) {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      familyId: true,
      name: true,
      itemType: true,
      color: true,
      sortOrder: true
    }
  });

  return assertEntityInFamily(
    category,
    familyId,
    "INVALID_FAMILY_CATEGORY",
    `Поле ${fieldName} должно ссылаться на категорию этой семьи`
  );
}

export async function ensureFamilyExecutors(executorIds: string[], familyId: string) {
  if (!executorIds.length) {
    return [] as Pick<Executor, "id" | "familyId" | "participantId" | "displayName" | "kind">[];
  }

  const executors = await prisma.executor.findMany({
    where: { id: { in: executorIds }, familyId },
    select: {
      id: true,
      familyId: true,
      participantId: true,
      displayName: true,
      kind: true
    }
  });

  if (executors.length !== executorIds.length) {
    throw new AppError({
      status: 400,
      code: "INVALID_FAMILY_EXECUTORS",
      detail: "Все исполнители должны принадлежать этой семье"
    });
  }

  return executors;
}

export function assertTaskExecutionPermission(params: {
  ctx: FamilyAuthContext;
  participantId: string;
  assignedParticipantIds: string[];
}) {
  if (params.ctx.role !== "CHILD") {
    return;
  }

  if (!params.ctx.participant || params.ctx.participant.id !== params.participantId) {
    throw new AppError({
      status: 403,
      code: "TASK_EXECUTION_FORBIDDEN",
      detail: "Ребёнок может отмечать выполнение только за себя"
    });
  }

  if (!params.assignedParticipantIds.includes(params.ctx.participant.id)) {
    throw new AppError({
      status: 403,
      code: "TASK_EXECUTION_FORBIDDEN",
      detail: "Ребёнок может выполнять только назначенные ему задания"
    });
  }
}
