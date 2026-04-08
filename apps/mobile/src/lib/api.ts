import type {
  AccountConnectionSummary,
  CategorySummary,
  DatabaseSnapshotResponse,
  FamilyBootstrapResponse,
  FamilyPreferencesResponse,
  FamilyRole,
  ExecutorSummary,
  FamilySummary,
  FamilySettingsResponse,
  OverviewResponse,
  PlannerItemRecord,
  PlannerItemType,
  PlannerPriority,
  PlannerStatus
} from "@family-app/contracts";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

export type PlannerFormPayload = {
  familyId: string;
  creatorParticipantId: string;
  categoryId: string;
  title: string;
  description?: string;
  itemType: PlannerItemType;
  priority: PlannerPriority;
  status: PlannerStatus;
  listName?: string;
  location?: string;
  scheduledStartAt?: string;
  dueAt?: string;
  reminderAt?: string;
  executorIds: string[];
};

const mockFamilySettings: FamilySettingsResponse = {
  family: {
    id: "11111111-1111-1111-1111-111111111111",
    name: "ДомВместе Demo",
    timezone: "Asia/Yekaterinburg",
    inviteCode: "FAMDEMO",
    appLanguage: "ru"
  },
  participants: [
    {
      id: "1",
      familyId: "11111111-1111-1111-1111-111111111111",
      displayName: "Анна",
      role: "PARENT",
      color: "#0EA5E9"
    },
    {
      id: "2",
      familyId: "11111111-1111-1111-1111-111111111111",
      displayName: "Максим",
      role: "PARENT",
      color: "#F97316"
    },
    {
      id: "3",
      familyId: "11111111-1111-1111-1111-111111111111",
      displayName: "Ника",
      role: "CHILD",
      color: "#8B5CF6"
    }
  ],
  executors: [
    {
      id: "e1",
      familyId: "11111111-1111-1111-1111-111111111111",
      participantId: "1",
      displayName: "Анна",
      kind: "FAMILY_MEMBER"
    },
    {
      id: "e2",
      familyId: "11111111-1111-1111-1111-111111111111",
      participantId: "2",
      displayName: "Максим",
      kind: "FAMILY_MEMBER"
    },
    {
      id: "e3",
      familyId: "11111111-1111-1111-1111-111111111111",
      participantId: "3",
      displayName: "Ника",
      kind: "FAMILY_MEMBER"
    }
  ],
  categories: [
    {
      id: "c1",
      familyId: "11111111-1111-1111-1111-111111111111",
      name: "Дом",
      itemType: "TASK",
      color: "#22C55E"
    },
    {
      id: "c2",
      familyId: "11111111-1111-1111-1111-111111111111",
      name: "Семейные события",
      itemType: "EVENT",
      color: "#0EA5E9"
    },
    {
      id: "c3",
      familyId: "11111111-1111-1111-1111-111111111111",
      name: "Покупки",
      itemType: "SHOPPING",
      color: "#F97316"
    }
  ]
};

const mockAccountConnections: AccountConnectionSummary[] = [
  {
    id: "a1",
    familyId: mockFamilySettings.family.id,
    provider: "GOOGLE",
    accountEmail: "anna.family@example.com",
    displayName: "Анна Google"
  },
  {
    id: "a2",
    familyId: mockFamilySettings.family.id,
    provider: "TELEGRAM",
    accountEmail: "domvmeste_demo@telegram.local",
    displayName: "Семейный Telegram"
  }
];

const mockPreferences: FamilyPreferencesResponse = {
  family: mockFamilySettings.family,
  accountConnections: mockAccountConnections
};

const mockOverview: OverviewResponse = {
  family: mockFamilySettings.family,
  participants: mockFamilySettings.participants,
  urgentItems: [
    {
      id: "task-1",
      familyId: mockFamilySettings.family.id,
      title: "Купить молоко и овощи",
      itemType: "SHOPPING",
      priority: "HIGH",
      status: "IN_PROGRESS",
      dueAt: "2026-04-08T15:00:00.000Z",
      scheduledStartAt: null,
      assigneeNames: ["Анна"]
    },
    {
      id: "task-2",
      familyId: mockFamilySettings.family.id,
      title: "Убрать детскую",
      itemType: "TASK",
      priority: "MEDIUM",
      status: "NEW",
      dueAt: "2026-04-09T14:00:00.000Z",
      scheduledStartAt: null,
      assigneeNames: ["Ника"]
    }
  ],
  todayItems: [
    {
      id: "event-1",
      familyId: mockFamilySettings.family.id,
      title: "Семейный ужин",
      itemType: "EVENT",
      priority: "MEDIUM",
      status: "NEW",
      scheduledStartAt: "2026-04-08T13:30:00.000Z",
      dueAt: "2026-04-08T15:00:00.000Z",
      assigneeNames: ["Анна", "Максим", "Ника"]
    }
  ]
};

const mockCalendar: PlannerItemRecord[] = [
  {
    id: "event-1",
    familyId: mockFamilySettings.family.id,
    creatorParticipantId: "2",
    title: "Семейный ужин",
    description: "Обсудить планы на выходные",
    itemType: "EVENT",
    priority: "MEDIUM",
    status: "NEW",
    categoryId: "c2",
    category: "Семейные события",
    executorIds: ["e1", "e2", "e3"],
    scheduledStartAt: "2026-04-08T13:30:00.000Z",
    dueAt: "2026-04-08T15:00:00.000Z",
    assigneeNames: ["Анна", "Максим", "Ника"],
    location: "Дом",
    reminderAt: null,
    completedAt: null
  }
];

const mockTasks: PlannerItemRecord[] = [
  {
    id: "task-2",
    familyId: mockFamilySettings.family.id,
    creatorParticipantId: "2",
    title: "Убрать детскую",
    description: "Разложить книги и игрушки",
    itemType: "TASK",
    priority: "MEDIUM",
    status: "NEW",
    categoryId: "c1",
    category: "Дом",
    executorIds: ["e3"],
    dueAt: "2026-04-09T14:00:00.000Z",
    scheduledStartAt: null,
    assigneeNames: ["Ника"],
    reminderAt: null,
    completedAt: null
  }
];

const mockShopping: PlannerItemRecord[] = [
  {
    id: "task-1",
    familyId: mockFamilySettings.family.id,
    creatorParticipantId: "1",
    title: "Купить молоко и овощи",
    description: "Молоко, огурцы, томаты",
    itemType: "SHOPPING",
    priority: "HIGH",
    status: "IN_PROGRESS",
    categoryId: "c3",
    category: "Покупки",
    executorIds: ["e1"],
    dueAt: "2026-04-08T15:00:00.000Z",
    scheduledStartAt: null,
    assigneeNames: ["Анна"],
    listName: "Неделя",
    reminderAt: null,
    completedAt: null
  }
];

const mockDatabaseSnapshot: DatabaseSnapshotResponse = {
  family: mockFamilySettings.family,
  participants: mockFamilySettings.participants,
  executors: mockFamilySettings.executors,
  categories: mockFamilySettings.categories,
  accountConnections: mockAccountConnections,
  tasks: [...mockOverview.urgentItems, ...mockOverview.todayItems]
};

type FamilyBootstrapPayload = {
  familyName: string;
  timezone: string;
  ownerName: string;
};

type FamilyUpdatePayload = {
  name?: string;
  timezone?: string;
};

type FamilyPreferencesPayload = {
  appLanguage: "ru" | "en";
};

type ParticipantPayload = {
  displayName: string;
  role: FamilyRole;
  color: string;
};

type ExecutorPayload = {
  displayName: string;
  kind: "FAMILY_MEMBER" | "EXTERNAL_HELPER";
};

type CategoryPayload = {
  name: string;
  itemType: PlannerItemType;
  color: string;
};

type AccountConnectionPayload = {
  provider: "GOOGLE" | "APPLE" | "TELEGRAM";
  accountEmail: string;
  displayName: string;
};

async function readRequest<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers
    });

    if (!response.ok) {
      if (response.status === 204) {
        return fallback;
      }

      throw new Error(`Request failed with status ${response.status}`);
    }

    if (response.status === 204) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function writeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getOverview(familyId: string) {
    return readRequest<OverviewResponse>(`/api/families/${familyId}/overview`, mockOverview);
  },
  getFamilySettings(familyId: string) {
    return readRequest<FamilySettingsResponse>(`/api/families/${familyId}/settings`, mockFamilySettings);
  },
  getCalendar(familyId: string) {
    return readRequest<PlannerItemRecord[]>(`/api/families/${familyId}/calendar`, mockCalendar);
  },
  getTasks(familyId: string) {
    return readRequest<PlannerItemRecord[]>(`/api/families/${familyId}/tasks`, mockTasks);
  },
  getShopping(familyId: string) {
    return readRequest<PlannerItemRecord[]>(`/api/families/${familyId}/shopping`, mockShopping);
  },
  getPreferences(familyId: string) {
    return readRequest<FamilyPreferencesResponse>(`/api/families/${familyId}/preferences`, mockPreferences);
  },
  getDatabaseSnapshot(familyId: string) {
    return readRequest<DatabaseSnapshotResponse>(`/api/families/${familyId}/database-snapshot`, mockDatabaseSnapshot);
  },
  createFamily(payload: FamilyBootstrapPayload) {
    return writeRequest<FamilyBootstrapResponse>(`/api/families/bootstrap`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateFamily(familyId: string, payload: FamilyUpdatePayload) {
    return writeRequest<FamilySummary>(`/api/families/${familyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  updatePreferences(familyId: string, payload: FamilyPreferencesPayload) {
    return writeRequest<FamilySummary>(`/api/families/${familyId}/preferences`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  createParticipant(familyId: string, payload: ParticipantPayload) {
    return writeRequest<FamilySettingsResponse["participants"][number]>(`/api/families/${familyId}/participants`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateParticipant(participantId: string, payload: Partial<ParticipantPayload>) {
    return writeRequest<FamilySettingsResponse["participants"][number]>(`/api/participants/${participantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteParticipant(participantId: string) {
    return writeRequest<null>(`/api/participants/${participantId}`, {
      method: "DELETE"
    });
  },
  createExecutor(familyId: string, payload: ExecutorPayload) {
    return writeRequest<ExecutorSummary>(`/api/families/${familyId}/executors`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateExecutor(executorId: string, payload: Partial<ExecutorPayload>) {
    return writeRequest<ExecutorSummary>(`/api/executors/${executorId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteExecutor(executorId: string) {
    return writeRequest<null>(`/api/executors/${executorId}`, {
      method: "DELETE"
    });
  },
  createCategory(familyId: string, payload: CategoryPayload) {
    return writeRequest<CategorySummary>(`/api/families/${familyId}/categories`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateCategory(categoryId: string, payload: Partial<CategoryPayload>) {
    return writeRequest<CategorySummary>(`/api/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteCategory(categoryId: string) {
    return writeRequest<null>(`/api/categories/${categoryId}`, {
      method: "DELETE"
    });
  },
  createAccountConnection(familyId: string, payload: AccountConnectionPayload) {
    return writeRequest<AccountConnectionSummary>(`/api/families/${familyId}/account-connections`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateAccountConnection(accountConnectionId: string, payload: Partial<AccountConnectionPayload>) {
    return writeRequest<AccountConnectionSummary>(`/api/account-connections/${accountConnectionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteAccountConnection(accountConnectionId: string) {
    return writeRequest<null>(`/api/account-connections/${accountConnectionId}`, {
      method: "DELETE"
    });
  },
  createTask(payload: PlannerFormPayload) {
    return writeRequest<PlannerItemRecord>(`/api/tasks`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateTask(taskId: string, payload: Partial<PlannerFormPayload>) {
    return writeRequest<PlannerItemRecord>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteTask(taskId: string) {
    return writeRequest<null>(`/api/tasks/${taskId}`, {
      method: "DELETE"
    });
  }
};
