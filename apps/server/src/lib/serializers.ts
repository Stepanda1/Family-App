import { PlannerItemType, PlannerPriority, PlannerStatus } from "@prisma/client";
import type { OverviewResponse, PlannerItemRecord, PlannerItemSummary } from "@family-app/contracts";

type TaskWithAssignments = {
  id: string;
  familyId: string;
  creatorParticipantId?: string;
  title: string;
  description?: string | null;
  itemType: PlannerItemType;
  priority: PlannerPriority;
  status: PlannerStatus;
  categoryId?: string;
  scheduledStartAt: Date | null;
  dueAt: Date | null;
  reminderAt?: Date | null;
  completedAt?: Date | null;
  listName?: string | null;
  location?: string | null;
  category?: {
    name: string;
  } | null;
  assignments: {
    executorId: string;
    executor: {
      displayName: string;
    };
  }[];
};

export function toPlannerItemSummary(task: TaskWithAssignments): PlannerItemSummary {
  return {
    id: task.id,
    familyId: task.familyId,
    title: task.title,
    itemType: task.itemType,
    priority: task.priority,
    status: task.status,
    scheduledStartAt: task.scheduledStartAt?.toISOString() ?? null,
    dueAt: task.dueAt?.toISOString() ?? null,
    assigneeNames: task.assignments.map((assignment) => assignment.executor.displayName)
  };
}

export function toPlannerItemRecord(task: TaskWithAssignments): PlannerItemRecord {
  return {
    ...toPlannerItemSummary(task),
    creatorParticipantId: task.creatorParticipantId ?? "",
    description: task.description,
    categoryId: task.categoryId ?? "",
    category: task.category?.name ?? null,
    executorIds: task.assignments.map((assignment) => assignment.executorId),
    listName: task.listName ?? null,
    location: task.location ?? null,
    reminderAt: task.reminderAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null
  };
}

export function buildOverviewResponse(input: {
  family: {
    id: string;
    name: string;
    timezone: string;
    inviteCode: string;
    appLanguage: "ru" | "en";
  };
  participants: {
    id: string;
    familyId: string;
    displayName: string;
    role: "PARENT" | "CHILD";
    color: string;
  }[];
  urgentItems: TaskWithAssignments[];
  todayItems: TaskWithAssignments[];
}): OverviewResponse {
  return {
    family: input.family,
    participants: input.participants,
    urgentItems: input.urgentItems.map(toPlannerItemSummary),
    todayItems: input.todayItems.map(toPlannerItemSummary)
  };
}
