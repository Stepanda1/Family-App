export type FamilyRole = "PARENT" | "CHILD";
export type AppLanguage = "ru" | "en";
export type AccountProvider = "GOOGLE" | "APPLE" | "TELEGRAM";

export type PlannerItemType = "TASK" | "EVENT" | "SHOPPING";

export type PlannerPriority = "LOW" | "MEDIUM" | "HIGH";

export type PlannerStatus = "NEW" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export type ExecutorKind = "FAMILY_MEMBER" | "EXTERNAL_HELPER";

export type ExecutionStatus = "SUCCESS" | "LATE" | "SKIPPED";

export interface FamilySummary {
  id: string;
  name: string;
  timezone: string;
  inviteCode: string;
  appLanguage: AppLanguage;
}

export interface ParticipantSummary {
  id: string;
  familyId: string;
  displayName: string;
  role: FamilyRole;
  color: string;
}

export interface PlannerItemSummary {
  id: string;
  familyId: string;
  title: string;
  itemType: PlannerItemType;
  priority: PlannerPriority;
  status: PlannerStatus;
  scheduledStartAt?: string | null;
  dueAt?: string | null;
  assigneeNames: string[];
}

export interface ExecutorSummary {
  id: string;
  familyId: string;
  participantId?: string | null;
  displayName: string;
  kind: ExecutorKind;
}

export interface CategorySummary {
  id: string;
  familyId: string;
  name: string;
  itemType: PlannerItemType;
  color: string;
}

export interface AccountConnectionSummary {
  id: string;
  familyId: string;
  provider: AccountProvider;
  accountEmail: string;
  displayName: string;
}

export interface PlannerItemRecord extends PlannerItemSummary {
  creatorParticipantId: string;
  description?: string | null;
  categoryId: string;
  category?: string | null;
  executorIds: string[];
  listName?: string | null;
  location?: string | null;
  reminderAt?: string | null;
  completedAt?: string | null;
}

export interface OverviewResponse {
  family: FamilySummary;
  participants: ParticipantSummary[];
  urgentItems: PlannerItemSummary[];
  todayItems: PlannerItemSummary[];
}

export interface FamilySettingsResponse {
  family: FamilySummary;
  participants: ParticipantSummary[];
  executors: ExecutorSummary[];
  categories: CategorySummary[];
}

export interface FamilyBootstrapResponse {
  family: FamilySummary;
  owner: ParticipantSummary;
}

export interface FamilyPreferencesResponse {
  family: FamilySummary;
  accountConnections: AccountConnectionSummary[];
}

export interface DatabaseSnapshotResponse {
  family: FamilySummary;
  participants: ParticipantSummary[];
  executors: ExecutorSummary[];
  categories: CategorySummary[];
  accountConnections: AccountConnectionSummary[];
  tasks: PlannerItemSummary[];
}
