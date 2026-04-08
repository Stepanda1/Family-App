import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import type { PlannerItemRecord, PlannerItemType, PlannerPriority, PlannerStatus } from "@family-app/contracts";
import {
  Badge,
  FieldLabel,
  HeroCard,
  Input,
  PrimaryButton,
  ScreenShell,
  SectionTitle,
  SoftCard
} from "../../src/components/ui";
import { api, type PlannerFormPayload } from "../../src/lib/api";
import { palette, spacing } from "../../src/lib/theme";
import { useFamilyStore } from "../../src/store/family-store";

type Mode = "TASKS" | "SHOPPING";

type PlannerFormState = {
  id?: string;
  title: string;
  description: string;
  itemType: PlannerItemType;
  priority: PlannerPriority;
  status: PlannerStatus;
  categoryId: string;
  creatorParticipantId: string;
  executorIds: string[];
  dueYear: number;
  dueMonth: number;
  dueDay: number;
  dueHour: number;
  dueMinute: number;
  listName: string;
  location: string;
};

export default function TasksScreen() {
  const familyId = useFamilyStore((state) => state.familyId);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("TASKS");
  const [editorVisible, setEditorVisible] = useState(false);
  const [form, setForm] = useState<PlannerFormState | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["family-settings", familyId],
    queryFn: () => api.getFamilySettings(familyId)
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", familyId],
    queryFn: () => api.getTasks(familyId)
  });
  const shoppingQuery = useQuery({
    queryKey: ["shopping", familyId],
    queryFn: () => api.getShopping(familyId)
  });

  const settings = settingsQuery.data;
  const items = mode === "TASKS" ? tasksQuery.data ?? [] : shoppingQuery.data ?? [];
  const categories = useMemo(
    () =>
      (settings?.categories ?? []).filter((category) =>
        mode === "TASKS" ? category.itemType === "TASK" : category.itemType === "SHOPPING"
      ),
    [mode, settings?.categories]
  );

  const createMutation = useMutation({
    mutationFn: (payload: PlannerFormPayload) => api.createTask(payload),
    onSuccess: async () => {
      await invalidateLists(queryClient, familyId);
      closeEditor();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { taskId: string; values: Partial<PlannerFormPayload> }) =>
      api.updateTask(payload.taskId, payload.values),
    onSuccess: async () => {
      await invalidateLists(queryClient, familyId);
      closeEditor();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => api.deleteTask(taskId),
    onSuccess: async () => {
      await invalidateLists(queryClient, familyId);
      closeEditor();
    }
  });

  function closeEditor() {
    setEditorVisible(false);
    setForm(null);
  }

  function openCreate() {
    if (!settings) {
      return;
    }

    const familyCategories = settings.categories.filter((category) =>
      mode === "TASKS" ? category.itemType === "TASK" : category.itemType === "SHOPPING"
    );

    setForm({
      title: "",
      description: "",
      itemType: mode === "TASKS" ? "TASK" : "SHOPPING",
      priority: mode === "TASKS" ? "MEDIUM" : "HIGH",
      status: "NEW",
      categoryId: familyCategories[0]?.id ?? "",
      creatorParticipantId: settings.participants[0]?.id ?? "",
      executorIds: settings.executors[0] ? [settings.executors[0].id] : [],
      ...createDefaultDateParts(),
      listName: mode === "SHOPPING" ? "Неделя" : "",
      location: ""
    });
    setEditorVisible(true);
  }

  function openEdit(item: PlannerItemRecord) {
    if (!settings) {
      return;
    }

    setForm({
      id: item.id,
      title: item.title,
      description: item.description ?? "",
      itemType: item.itemType,
      priority: item.priority,
      status: item.status,
      categoryId: item.categoryId,
      creatorParticipantId: item.creatorParticipantId,
      executorIds: item.executorIds,
      ...fromIsoToDateParts(item.dueAt),
      listName: item.listName ?? "",
      location: item.location ?? ""
    });
    setEditorVisible(true);
  }

  function toggleExecutor(executorId: string) {
    setForm((current) =>
      current
        ? {
            ...current,
            executorIds: current.executorIds.includes(executorId)
              ? current.executorIds.filter((id) => id !== executorId)
              : [...current.executorIds, executorId]
          }
        : current
    );
  }

  async function submitForm() {
    if (!form || !settings) {
      return;
    }

    const payload: PlannerFormPayload = {
      familyId,
      creatorParticipantId: form.creatorParticipantId,
      categoryId: form.categoryId,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      itemType: form.itemType,
      priority: form.priority,
      status: form.status,
      listName: form.itemType === "SHOPPING" ? form.listName.trim() || undefined : undefined,
      location: form.location.trim() || undefined,
      dueAt: toIsoFromDateParts(form),
      executorIds: form.executorIds
    };

    if (form.id) {
      await updateMutation.mutateAsync({ taskId: form.id, values: payload });
      return;
    }

    await createMutation.mutateAsync(payload);
  }

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.content}>
        <HeroCard
          eyebrow="Списки и дела"
          title="Задачи семьи теперь можно не только смотреть, но и менять"
          description="Создавайте новые задачи, редактируйте сроки и ответственных, убирайте лишнее из общего списка."
          actionLabel={mode === "TASKS" ? "Новая задача" : "Новая покупка"}
          onActionPress={openCreate}
        />

        <View style={styles.segment}>
          <SegmentButton active={mode === "TASKS"} label="Задачи" onPress={() => setMode("TASKS")} />
          <SegmentButton active={mode === "SHOPPING"} label="Покупки" onPress={() => setMode("SHOPPING")} />
        </View>

        <SectionTitle
          title={mode === "TASKS" ? "Активные задачи" : "Список покупок"}
          caption={items.length ? `${items.length} записей` : "пока пусто"}
        />
        <View style={styles.stack}>
          {items.map((item) => (
            <SoftCard
              key={item.id}
              accentColor={item.priority === "HIGH" ? "#FECACA" : "#DBEAFE"}
              onPress={() => openEdit(item)}
            >
              <View style={styles.row}>
                <Badge
                  label={item.category ?? (mode === "TASKS" ? "Задача" : "Покупка")}
                  tone={item.priority === "HIGH" ? "warning" : "info"}
                />
                <Text style={styles.deadline}>{formatDate(item.dueAt)}</Text>
              </View>
              <Text style={styles.title}>{item.title}</Text>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
              <Text style={styles.meta}>Ответственные: {item.assigneeNames.join(", ") || "Не назначены"}</Text>
              {item.listName ? <Text style={styles.meta}>Список: {item.listName}</Text> : null}
              <View style={styles.footerRow}>
                <Badge label={statusLabels[item.status]} tone="neutral" />
                <Text style={styles.editHint}>Нажмите, чтобы изменить</Text>
              </View>
            </SoftCard>
          ))}
          {!items.length ? (
            <SoftCard accentColor="#E5E7EB">
              <Text style={styles.emptyTitle}>Список пока пуст</Text>
              <Text style={styles.emptyText}>
                Добавьте первую {mode === "TASKS" ? "задачу" : "покупку"}, чтобы распределить ответственность в семье.
              </Text>
            </SoftCard>
          ) : null}
        </View>
      </ScrollView>

      <Pressable onPress={openCreate} style={styles.fab}>
        <Ionicons color="#fff" name="add" size={28} />
      </Pressable>

      <Modal animationType="fade" transparent visible={editorVisible} onRequestClose={closeEditor}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{form?.id ? "Редактирование" : "Новая запись"}</Text>
                <Pressable onPress={closeEditor} style={styles.closeButton}>
                  <Ionicons color={palette.ink} name="close" size={20} />
                </Pressable>
              </View>

              <View>
                <FieldLabel>Название</FieldLabel>
                <Input
                  placeholder="Например, оплатить кружок"
                  value={form?.title ?? ""}
                  onChangeText={(value) => setForm((current) => (current ? { ...current, title: value } : current))}
                />
              </View>

              <View>
                <FieldLabel>Описание</FieldLabel>
                <Input
                  multiline
                  numberOfLines={3}
                  placeholder="Короткая заметка"
                  style={styles.textArea}
                  value={form?.description ?? ""}
                  onChangeText={(value) => setForm((current) => (current ? { ...current, description: value } : current))}
                />
              </View>

              <FieldBlock
                label="Категория"
                content={
                  <Picker
                    selectedValue={form?.categoryId}
                    onValueChange={(value) =>
                      setForm((current) => (current ? { ...current, categoryId: String(value) } : current))
                    }
                  >
                    {categories.map((category) => (
                      <Picker.Item key={category.id} label={category.name} value={category.id} />
                    ))}
                  </Picker>
                }
              />

              <FieldBlock
                label="Создатель"
                content={
                  <Picker
                    selectedValue={form?.creatorParticipantId}
                    onValueChange={(value) =>
                      setForm((current) =>
                        current ? { ...current, creatorParticipantId: String(value) } : current
                      )
                    }
                  >
                    {(settings?.participants ?? []).map((participant) => (
                      <Picker.Item key={participant.id} label={participant.displayName} value={participant.id} />
                    ))}
                  </Picker>
                }
              />

              <View style={styles.doubleRow}>
                <FieldBlock
                  label="Приоритет"
                  content={
                    <Picker
                      selectedValue={form?.priority}
                      onValueChange={(value) =>
                        setForm((current) => (current ? { ...current, priority: value as PlannerPriority } : current))
                      }
                    >
                      <Picker.Item label="Низкий" value="LOW" />
                      <Picker.Item label="Средний" value="MEDIUM" />
                      <Picker.Item label="Высокий" value="HIGH" />
                    </Picker>
                  }
                  style={styles.doubleCell}
                />
                <FieldBlock
                  label="Статус"
                  content={
                    <Picker
                      selectedValue={form?.status}
                      onValueChange={(value) =>
                        setForm((current) => (current ? { ...current, status: value as PlannerStatus } : current))
                      }
                    >
                      <Picker.Item label="Новое" value="NEW" />
                      <Picker.Item label="В работе" value="IN_PROGRESS" />
                      <Picker.Item label="Готово" value="DONE" />
                      <Picker.Item label="Отменено" value="CANCELLED" />
                    </Picker>
                  }
                  style={styles.doubleCell}
                />
              </View>

              <View>
                <FieldLabel>Дедлайн</FieldLabel>
                <View style={styles.datePickerGrid}>
                  <FieldBlock
                    label="Год"
                    style={styles.dateCell}
                    content={
                      <Picker
                        selectedValue={form?.dueYear}
                        onValueChange={(value) =>
                          setForm((current) => (current ? { ...current, dueYear: Number(value) } : current))
                        }
                      >
                        {yearOptions.map((year) => (
                          <Picker.Item key={year} label={String(year)} value={year} />
                        ))}
                      </Picker>
                    }
                  />
                  <FieldBlock
                    label="Месяц"
                    style={styles.dateCell}
                    content={
                      <Picker
                        selectedValue={form?.dueMonth}
                        onValueChange={(value) =>
                          setForm((current) => (current ? { ...current, dueMonth: Number(value) } : current))
                        }
                      >
                        {monthOptions.map((month) => (
                          <Picker.Item key={month.value} label={month.label} value={month.value} />
                        ))}
                      </Picker>
                    }
                  />
                </View>
                <View style={styles.datePickerGrid}>
                  <FieldBlock
                    label="День"
                    style={styles.dateCell}
                    content={
                      <Picker
                        selectedValue={form?.dueDay}
                        onValueChange={(value) =>
                          setForm((current) => (current ? { ...current, dueDay: Number(value) } : current))
                        }
                      >
                        {dayOptions(form?.dueYear ?? currentYear, form?.dueMonth ?? currentMonth).map((day) => (
                          <Picker.Item key={day} label={String(day)} value={day} />
                        ))}
                      </Picker>
                    }
                  />
                  <FieldBlock
                    label="Час"
                    style={styles.dateCell}
                    content={
                      <Picker
                        selectedValue={form?.dueHour}
                        onValueChange={(value) =>
                          setForm((current) => (current ? { ...current, dueHour: Number(value) } : current))
                        }
                      >
                        {hourOptions.map((hour) => (
                          <Picker.Item key={hour} label={pad(hour)} value={hour} />
                        ))}
                      </Picker>
                    }
                  />
                  <FieldBlock
                    label="Минуты"
                    style={styles.dateCell}
                    content={
                      <Picker
                        selectedValue={form?.dueMinute}
                        onValueChange={(value) =>
                          setForm((current) => (current ? { ...current, dueMinute: Number(value) } : current))
                        }
                      >
                        {minuteOptions.map((minute) => (
                          <Picker.Item key={minute} label={pad(minute)} value={minute} />
                        ))}
                      </Picker>
                    }
                  />
                </View>
                <Text style={styles.helper}>Дата и время выбираются отдельно, без ручного ввода.</Text>
              </View>

              {form?.itemType === "SHOPPING" ? (
                <View>
                  <FieldLabel>Название списка</FieldLabel>
                  <Input
                    placeholder="Неделя"
                    value={form?.listName ?? ""}
                    onChangeText={(value) => setForm((current) => (current ? { ...current, listName: value } : current))}
                  />
                </View>
              ) : null}

              <View>
                <FieldLabel>Место</FieldLabel>
                <Input
                  placeholder="Дом, магазин, школа"
                  value={form?.location ?? ""}
                  onChangeText={(value) => setForm((current) => (current ? { ...current, location: value } : current))}
                />
              </View>

              <View>
                <FieldLabel>Исполнители</FieldLabel>
                <View style={styles.executorWrap}>
                  {(settings?.executors ?? []).map((executor) => {
                    const active = form?.executorIds.includes(executor.id);
                    return (
                      <Pressable
                        key={executor.id}
                        onPress={() => toggleExecutor(executor.id)}
                        style={[styles.executorChip, active ? styles.executorChipActive : null]}
                      >
                        <Text style={[styles.executorChipText, active ? styles.executorChipTextActive : null]}>
                          {executor.displayName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.actionStack}>
                <PrimaryButton label={form?.id ? "Сохранить изменения" : "Добавить"} onPress={submitForm} />
                {form?.id ? (
                  <PrimaryButton
                    label="Удалить задачу"
                    onPress={async () => {
                      if (form?.id) {
                        await deleteMutation.mutateAsync(form.id);
                      }
                    }}
                    tone="danger"
                  />
                ) : null}
                <PrimaryButton label="Закрыть" onPress={closeEditor} tone="light" />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

function FieldBlock(props: { label: string; content: React.ReactNode; style?: object }) {
  return (
    <View style={props.style}>
      <FieldLabel>{props.label}</FieldLabel>
      <View style={styles.pickerWrap}>{props.content}</View>
    </View>
  );
}

function SegmentButton(props: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={[styles.segmentButton, props.active && styles.segmentButtonActive]}>
      <Text style={[styles.segmentText, props.active && styles.segmentTextActive]}>{props.label}</Text>
    </Pressable>
  );
}

async function invalidateLists(queryClient: ReturnType<typeof useQueryClient>, familyId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["overview", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["tasks", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["shopping", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["calendar", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["family-settings", familyId] })
  ]);
}

function toIsoFromDateParts(value: PlannerFormState) {
  const date = new Date(
    value.dueYear,
    value.dueMonth - 1,
    value.dueDay,
    value.dueHour,
    value.dueMinute,
    0,
    0
  );

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function fromIsoToDateParts(value?: string | null) {
  if (!value) {
    return createDefaultDateParts();
  }

  const date = new Date(value);
  return {
    dueYear: date.getFullYear(),
    dueMonth: date.getMonth() + 1,
    dueDay: date.getDate(),
    dueHour: date.getHours(),
    dueMinute: nearestMinute(date.getMinutes())
  };
}

function createDefaultDateParts() {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);

  return {
    dueYear: date.getFullYear(),
    dueMonth: date.getMonth() + 1,
    dueDay: date.getDate(),
    dueHour: date.getHours(),
    dueMinute: date.getMinutes()
  };
}

function nearestMinute(value: number) {
  const options = [0, 15, 30, 45];
  return options.reduce((closest, current) =>
    Math.abs(current - value) < Math.abs(closest - value) ? current : closest
  );
}

function dayOptions(year: number, month: number) {
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: count }, (_, index) => index + 1);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Без дедлайна";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const statusLabels = {
  NEW: "Новое",
  IN_PROGRESS: "В работе",
  DONE: "Готово",
  CANCELLED: "Отменено"
};

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;
const yearOptions = [currentYear, currentYear + 1, currentYear + 2];
const monthOptions = [
  { value: 1, label: "Январь" },
  { value: 2, label: "Февраль" },
  { value: 3, label: "Март" },
  { value: 4, label: "Апрель" },
  { value: 5, label: "Май" },
  { value: 6, label: "Июнь" },
  { value: 7, label: "Июль" },
  { value: 8, label: "Август" },
  { value: 9, label: "Сентябрь" },
  { value: 10, label: "Октябрь" },
  { value: 11, label: "Ноябрь" },
  { value: 12, label: "Декабрь" }
];
const hourOptions = Array.from({ length: 24 }, (_, index) => index);
const minuteOptions = [0, 15, 30, 45];

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: 140
  },
  segment: {
    backgroundColor: "rgba(255,255,255,0.86)",
    borderRadius: 20,
    padding: 6,
    flexDirection: "row",
    gap: 6
  },
  segmentButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center"
  },
  segmentButtonActive: {
    backgroundColor: palette.ink
  },
  segmentText: {
    color: palette.slate,
    fontWeight: "700"
  },
  segmentTextActive: {
    color: palette.paper
  },
  stack: {
    gap: spacing.md
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  deadline: {
    color: palette.slate,
    fontSize: 13,
    fontWeight: "700"
  },
  title: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "800",
    marginTop: spacing.sm
  },
  description: {
    color: palette.ink,
    marginTop: 8,
    lineHeight: 20
  },
  meta: {
    color: palette.slate,
    marginTop: 6,
    fontSize: 14
  },
  footerRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  editHint: {
    color: palette.blue,
    fontSize: 12,
    fontWeight: "700"
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  emptyText: {
    color: palette.slate,
    marginTop: 8,
    lineHeight: 20
  },
  fab: {
    position: "absolute",
    right: 24,
    bottom: 104,
    width: 62,
    height: 62,
    borderRadius: 999,
    backgroundColor: palette.ink,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#163B65",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10,25,47,0.38)",
    justifyContent: "flex-end"
  },
  modalSheet: {
    maxHeight: "88%",
    backgroundColor: "#FFFDFB",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: spacing.lg
  },
  modalContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  modalTitle: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "800"
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#EEF4FB",
    alignItems: "center",
    justifyContent: "center"
  },
  textArea: {
    minHeight: 88,
    textAlignVertical: "top"
  },
  helper: {
    color: palette.slate,
    marginTop: 6,
    fontSize: 12
  },
  datePickerGrid: {
    flexDirection: "row",
    gap: spacing.sm
  },
  dateCell: {
    flex: 1
  },
  pickerWrap: {
    borderRadius: 16,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#DDE7F2",
    overflow: "hidden"
  },
  doubleRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  doubleCell: {
    flex: 1
  },
  executorWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  executorChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#EEF4FB"
  },
  executorChipActive: {
    backgroundColor: palette.ink
  },
  executorChipText: {
    color: palette.ink,
    fontWeight: "700"
  },
  executorChipTextActive: {
    color: palette.paper
  },
  actionStack: {
    gap: 10,
    marginTop: 8
  }
});
