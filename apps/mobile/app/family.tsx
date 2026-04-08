import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Picker } from "@react-native-picker/picker";
import type { AccountProvider, AppLanguage, FamilyRole, PlannerItemType } from "@family-app/contracts";
import {
  Badge,
  FieldLabel,
  HeroCard,
  Input,
  PrimaryButton,
  ScreenShell,
  SectionTitle,
  SoftCard
} from "../src/components/ui";
import { api } from "../src/lib/api";
import { palette, spacing } from "../src/lib/theme";
import { useFamilyStore } from "../src/store/family-store";

type FamilyFormState = {
  name: string;
  timezone: string;
};

type FamilyCreateState = {
  familyName: string;
  ownerName: string;
  timezone: string;
};

type ParticipantFormState = {
  id?: string;
  displayName: string;
  role: FamilyRole;
  color: string;
};

type ExecutorFormState = {
  id?: string;
  displayName: string;
  kind: "EXTERNAL_HELPER";
};

type CategoryFormState = {
  id?: string;
  name: string;
  itemType: PlannerItemType;
  color: string;
};

type AccountConnectionFormState = {
  id?: string;
  provider: AccountProvider;
  accountEmail: string;
  displayName: string;
};

const commonTimezones = ["Asia/Yekaterinburg", "Europe/Moscow", "Asia/Almaty", "Asia/Dubai"];
const colorOptions = ["#0EA5E9", "#F97316", "#8B5CF6", "#22C55E", "#EF4444", "#F59E0B"];

export default function FamilyScreen() {
  const familyId = useFamilyStore((state) => state.familyId);
  const setFamilyId = useFamilyStore((state) => state.setFamilyId);
  const queryClient = useQueryClient();
  const [familyForm, setFamilyForm] = useState<FamilyFormState>({ name: "", timezone: "Asia/Yekaterinburg" });
  const [createFamilyVisible, setCreateFamilyVisible] = useState(false);
  const [participantVisible, setParticipantVisible] = useState(false);
  const [executorVisible, setExecutorVisible] = useState(false);
  const [categoryVisible, setCategoryVisible] = useState(false);
  const [accountVisible, setAccountVisible] = useState(false);
  const [createFamilyForm, setCreateFamilyForm] = useState<FamilyCreateState>({
    familyName: "",
    ownerName: "",
    timezone: "Asia/Yekaterinburg"
  });
  const [participantForm, setParticipantForm] = useState<ParticipantFormState | null>(null);
  const [executorForm, setExecutorForm] = useState<ExecutorFormState | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null);
  const [language, setLanguage] = useState<AppLanguage>("ru");
  const [accountForm, setAccountForm] = useState<AccountConnectionFormState | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["family-settings", familyId],
    queryFn: () => api.getFamilySettings(familyId)
  });

  const preferencesQuery = useQuery({
    queryKey: ["preferences", familyId],
    queryFn: () => api.getPreferences(familyId)
  });

  const databaseSnapshotQuery = useQuery({
    queryKey: ["database-snapshot", familyId],
    queryFn: () => api.getDatabaseSnapshot(familyId)
  });

  const settings = settingsQuery.data;
  const preferences = preferencesQuery.data;
  const databaseSnapshot = databaseSnapshotQuery.data;
  const helperExecutors = useMemo(
    () => (settings?.executors ?? []).filter((executor) => executor.kind === "EXTERNAL_HELPER"),
    [settings?.executors]
  );

  useEffect(() => {
    if (!settings) {
      return;
    }

    setFamilyForm({
      name: settings.family.name,
      timezone: settings.family.timezone
    });
  }, [settings]);

  useEffect(() => {
    if (!preferences) {
      return;
    }

    setLanguage(preferences.family.appLanguage);
  }, [preferences]);

  const updateFamilyMutation = useMutation({
    mutationFn: () => api.updateFamily(familyId, familyForm),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
    }
  });

  const createFamilyMutation = useMutation({
    mutationFn: () => api.createFamily(createFamilyForm),
    onSuccess: async (result) => {
      setFamilyId(result.family.id);
      setCreateFamilyVisible(false);
      setCreateFamilyForm({
        familyName: "",
        ownerName: "",
        timezone: createFamilyForm.timezone
      });
      await invalidateFamily(queryClient, result.family.id);
    }
  });

  const createParticipantMutation = useMutation({
    mutationFn: (payload: ParticipantFormState) =>
      api.createParticipant(familyId, {
        displayName: payload.displayName,
        role: payload.role,
        color: payload.color
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeParticipantEditor();
    }
  });

  const updateParticipantMutation = useMutation({
    mutationFn: (payload: ParticipantFormState) =>
      api.updateParticipant(payload.id!, {
        displayName: payload.displayName,
        role: payload.role,
        color: payload.color
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeParticipantEditor();
    }
  });

  const deleteParticipantMutation = useMutation({
    mutationFn: (participantId: string) => api.deleteParticipant(participantId),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeParticipantEditor();
    }
  });

  const createExecutorMutation = useMutation({
    mutationFn: (payload: ExecutorFormState) =>
      api.createExecutor(familyId, {
        displayName: payload.displayName,
        kind: "EXTERNAL_HELPER"
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeExecutorEditor();
    }
  });

  const updateExecutorMutation = useMutation({
    mutationFn: (payload: ExecutorFormState) =>
      api.updateExecutor(payload.id!, {
        displayName: payload.displayName,
        kind: "EXTERNAL_HELPER"
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeExecutorEditor();
    }
  });

  const deleteExecutorMutation = useMutation({
    mutationFn: (executorId: string) => api.deleteExecutor(executorId),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeExecutorEditor();
    }
  });

  const createCategoryMutation = useMutation({
    mutationFn: (payload: CategoryFormState) =>
      api.createCategory(familyId, {
        name: payload.name,
        itemType: payload.itemType,
        color: payload.color
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeCategoryEditor();
    }
  });

  const updateCategoryMutation = useMutation({
    mutationFn: (payload: CategoryFormState) =>
      api.updateCategory(payload.id!, {
        name: payload.name,
        itemType: payload.itemType,
        color: payload.color
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeCategoryEditor();
    }
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: string) => api.deleteCategory(categoryId),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeCategoryEditor();
    }
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: () => api.updatePreferences(familyId, { appLanguage: language }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
    }
  });

  const createAccountConnectionMutation = useMutation({
    mutationFn: (payload: AccountConnectionFormState) =>
      api.createAccountConnection(familyId, {
        provider: payload.provider,
        accountEmail: payload.accountEmail,
        displayName: payload.displayName
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeAccountEditor();
    }
  });

  const updateAccountConnectionMutation = useMutation({
    mutationFn: (payload: AccountConnectionFormState) =>
      api.updateAccountConnection(payload.id!, {
        provider: payload.provider,
        accountEmail: payload.accountEmail,
        displayName: payload.displayName
      }),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeAccountEditor();
    }
  });

  const deleteAccountConnectionMutation = useMutation({
    mutationFn: (accountConnectionId: string) => api.deleteAccountConnection(accountConnectionId),
    onSuccess: async () => {
      await invalidateFamily(queryClient, familyId);
      closeAccountEditor();
    }
  });

  function openParticipantCreate() {
    setParticipantForm({
      displayName: "",
      role: "CHILD",
      color: colorOptions[0]
    });
    setParticipantVisible(true);
  }

  function openParticipantEdit(participantId: string) {
    const participant = settings?.participants.find((item) => item.id === participantId);
    if (!participant) {
      return;
    }

    setParticipantForm({
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role,
      color: participant.color
    });
    setParticipantVisible(true);
  }

  function closeParticipantEditor() {
    setParticipantVisible(false);
    setParticipantForm(null);
  }

  function openExecutorCreate() {
    setExecutorForm({
      displayName: "",
      kind: "EXTERNAL_HELPER"
    });
    setExecutorVisible(true);
  }

  function openExecutorEdit(executorId: string) {
    const executor = helperExecutors.find((item) => item.id === executorId);
    if (!executor) {
      return;
    }

    setExecutorForm({
      id: executor.id,
      displayName: executor.displayName,
      kind: "EXTERNAL_HELPER"
    });
    setExecutorVisible(true);
  }

  function closeExecutorEditor() {
    setExecutorVisible(false);
    setExecutorForm(null);
  }

  function openCategoryCreate() {
    setCategoryForm({
      name: "",
      itemType: "TASK",
      color: colorOptions[0]
    });
    setCategoryVisible(true);
  }

  function openCategoryEdit(categoryId: string) {
    const category = settings?.categories.find((item) => item.id === categoryId);
    if (!category) {
      return;
    }

    setCategoryForm({
      id: category.id,
      name: category.name,
      itemType: category.itemType,
      color: category.color
    });
    setCategoryVisible(true);
  }

  function closeCategoryEditor() {
    setCategoryVisible(false);
    setCategoryForm(null);
  }

  function openAccountCreate() {
    setAccountForm({
      provider: "GOOGLE",
      accountEmail: "",
      displayName: ""
    });
    setAccountVisible(true);
  }

  function openAccountEdit(accountConnectionId: string) {
    const accountConnection = preferences?.accountConnections.find((item) => item.id === accountConnectionId);
    if (!accountConnection) {
      return;
    }

    setAccountForm({
      id: accountConnection.id,
      provider: accountConnection.provider,
      accountEmail: accountConnection.accountEmail,
      displayName: accountConnection.displayName
    });
    setAccountVisible(true);
  }

  function closeAccountEditor() {
    setAccountVisible(false);
    setAccountForm(null);
  }

  async function submitParticipant() {
    if (!participantForm) {
      return;
    }

    if (participantForm.id) {
      await updateParticipantMutation.mutateAsync(participantForm);
      return;
    }

    await createParticipantMutation.mutateAsync(participantForm);
  }

  async function submitExecutor() {
    if (!executorForm) {
      return;
    }

    if (executorForm.id) {
      await updateExecutorMutation.mutateAsync(executorForm);
      return;
    }

    await createExecutorMutation.mutateAsync(executorForm);
  }

  async function submitCategory() {
    if (!categoryForm) {
      return;
    }

    if (categoryForm.id) {
      await updateCategoryMutation.mutateAsync(categoryForm);
      return;
    }

    await createCategoryMutation.mutateAsync(categoryForm);
  }

  async function submitAccountConnection() {
    if (!accountForm) {
      return;
    }

    if (accountForm.id) {
      await updateAccountConnectionMutation.mutateAsync(accountForm);
      return;
    }

    await createAccountConnectionMutation.mutateAsync(accountForm);
  }

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons color={palette.ink} name="chevron-back" size={22} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Семья</Text>
          <TouchableOpacity onPress={() => setCreateFamilyVisible(true)} style={styles.backButton}>
            <Ionicons color={palette.ink} name="add" size={20} />
          </TouchableOpacity>
        </View>

        <HeroCard
          eyebrow="ДомВместе"
          title="Семья, участники и категории в одном месте"
          description="Участники автоматически синхронизируются с исполнителями. Здесь управляется состав семьи, помощники и рабочие категории."
          actionLabel="Создать семью"
          onActionPress={() => setCreateFamilyVisible(true)}
        />

        <SoftCard accentColor="#DCEAFE">
          <View style={styles.headerLine}>
            <View>
              <Text style={styles.inviteLabel}>Код подключения</Text>
              <Text style={styles.inviteValue}>{settings?.family.inviteCode ?? "..."}</Text>
            </View>
            <Badge label={settings?.family.timezone ?? "..."} tone="info" />
          </View>
          <Text style={styles.inviteNote}>Эта семья открыта сейчас. Можно менять её параметры и создавать новые семейные пространства.</Text>

          <View style={styles.formBlock}>
            <FieldLabel>Название семьи</FieldLabel>
            <Input
              value={familyForm.name}
              onChangeText={(value) => setFamilyForm((current) => ({ ...current, name: value }))}
              placeholder="Например, Дом на неделе"
            />
          </View>

          <FieldBlock
            label="Часовой пояс"
            content={
              <Picker
                selectedValue={familyForm.timezone}
                onValueChange={(value) =>
                  setFamilyForm((current) => ({ ...current, timezone: String(value) }))
                }
              >
                {commonTimezones.map((timezone) => (
                  <Picker.Item key={timezone} label={timezone} value={timezone} />
                ))}
              </Picker>
            }
          />

          <PrimaryButton label="Сохранить семью" onPress={() => updateFamilyMutation.mutate()} />
        </SoftCard>

        <SectionTitle title="Участники" caption="создание и синхронизация исполнителей" />
        <View style={styles.stack}>
          {settings?.participants.map((participant) => (
            <SoftCard key={participant.id} accentColor={participant.color}>
              <View style={styles.editableRow}>
                <View style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: participant.color }]} />
                  <View style={styles.textWrap}>
                    <Text style={styles.name}>{participant.displayName}</Text>
                    <Text style={styles.role}>{participant.role === "PARENT" ? "Родитель" : "Ребёнок"}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => openParticipantEdit(participant.id)} style={styles.inlineAction}>
                  <Ionicons color={palette.blue} name="create-outline" size={20} />
                </TouchableOpacity>
              </View>
            </SoftCard>
          ))}
          <PrimaryButton label="Добавить участника" onPress={openParticipantCreate} />
        </View>

        <SectionTitle title="Исполнители" caption="только внешние помощники" />
        <SoftCard accentColor="#FDE68A">
          <Text style={styles.noteTitle}>Связанные участники убраны</Text>
          <Text style={styles.noteText}>Члены семьи теперь автоматически становятся исполнителями. Здесь редактируются только внешние помощники.</Text>
        </SoftCard>
        <View style={styles.stack}>
          {helperExecutors.map((executor) => (
            <SoftCard key={executor.id} accentColor="#FDE68A">
              <View style={styles.editableRow}>
                <View style={styles.textWrap}>
                  <Text style={styles.name}>{executor.displayName}</Text>
                  <Text style={styles.role}>Внешний помощник</Text>
                </View>
                <TouchableOpacity onPress={() => openExecutorEdit(executor.id)} style={styles.inlineAction}>
                  <Ionicons color={palette.blue} name="create-outline" size={20} />
                </TouchableOpacity>
              </View>
            </SoftCard>
          ))}
          <PrimaryButton label="Добавить помощника" onPress={openExecutorCreate} />
        </View>

        <SectionTitle title="Категории" caption="создание, изменение и удаление" />
        <View style={styles.stack}>
          {settings?.categories.map((category) => (
            <SoftCard key={category.id} accentColor={category.color}>
              <View style={styles.editableRow}>
                <View style={styles.textWrap}>
                  <Badge label={typeLabel[category.itemType]} tone="neutral" />
                  <Text style={styles.categoryName}>{category.name}</Text>
                </View>
                <TouchableOpacity onPress={() => openCategoryEdit(category.id)} style={styles.inlineAction}>
                  <Ionicons color={palette.blue} name="create-outline" size={20} />
                </TouchableOpacity>
              </View>
            </SoftCard>
          ))}
          <PrimaryButton label="Добавить категорию" onPress={openCategoryCreate} />
        </View>

        <SectionTitle title="Настройки" caption="язык приложения и семейный профиль" />
        <SoftCard accentColor="#BFDBFE">
          <FieldBlock
            label="Язык интерфейса"
            content={
              <Picker selectedValue={language} onValueChange={(value) => setLanguage(value as AppLanguage)}>
                <Picker.Item label="Русский" value="ru" />
                <Picker.Item label="English" value="en" />
              </Picker>
            }
          />
          <PrimaryButton label="Сохранить язык" onPress={() => updatePreferencesMutation.mutate()} />
        </SoftCard>

        <SectionTitle title="Синхронизация аккаунтов" caption="подключённые внешние учётные записи" />
        <View style={styles.stack}>
          {(preferences?.accountConnections ?? []).map((accountConnection) => (
            <SoftCard key={accountConnection.id} accentColor="#C7D2FE">
              <View style={styles.editableRow}>
                <View style={styles.textWrap}>
                  <Badge label={providerLabel[accountConnection.provider]} tone="info" />
                  <Text style={styles.categoryName}>{accountConnection.displayName}</Text>
                  <Text style={styles.helper}>{accountConnection.accountEmail}</Text>
                </View>
                <TouchableOpacity onPress={() => openAccountEdit(accountConnection.id)} style={styles.inlineAction}>
                  <Ionicons color={palette.blue} name="create-outline" size={20} />
                </TouchableOpacity>
              </View>
            </SoftCard>
          ))}
          <PrimaryButton label="Подключить аккаунт" onPress={openAccountCreate} />
        </View>

        <SectionTitle title="База данных" caption="живой снимок текущих таблиц" />
        <SoftCard accentColor="#FCD34D">
          <Text style={styles.noteTitle}>Текущее состояние БД</Text>
          <Text style={styles.noteText}>
            Семей: 1, участников: {databaseSnapshot?.participants.length ?? 0}, исполнителей: {databaseSnapshot?.executors.length ?? 0},
            категорий: {databaseSnapshot?.categories.length ?? 0}, аккаунтов: {databaseSnapshot?.accountConnections.length ?? 0}, записей: {databaseSnapshot?.tasks.length ?? 0}
          </Text>
        </SoftCard>

        <View style={styles.stack}>
          {databaseSnapshot?.family ? (
            <SoftCard key={`db-family-${databaseSnapshot.family.id}`} accentColor="#FDE68A">
              <Badge label="families" tone="neutral" />
              <Text style={styles.categoryName}>{databaseSnapshot.family.name}</Text>
              <Text style={styles.helper}>
                {databaseSnapshot.family.timezone} · {databaseSnapshot.family.inviteCode} · язык {databaseSnapshot.family.appLanguage}
              </Text>
              <Text style={styles.helper}>{databaseSnapshot.family.id}</Text>
            </SoftCard>
          ) : null}

          {(databaseSnapshot?.participants ?? []).map((participant) => (
            <SoftCard key={`db-participant-${participant.id}`} accentColor={participant.color}>
              <Badge label="participants" tone="neutral" />
              <Text style={styles.categoryName}>{participant.displayName}</Text>
              <Text style={styles.helper}>{participant.role === "PARENT" ? "Родитель" : "Ребёнок"}</Text>
              <Text style={styles.helper}>{participant.id}</Text>
            </SoftCard>
          ))}

          {(databaseSnapshot?.executors ?? []).map((executor) => (
            <SoftCard key={`db-executor-${executor.id}`} accentColor={executor.kind === "FAMILY_MEMBER" ? "#BFDBFE" : "#FDE68A"}>
              <Badge label="executors" tone="neutral" />
              <Text style={styles.categoryName}>{executor.displayName}</Text>
              <Text style={styles.helper}>
                {executor.kind === "FAMILY_MEMBER" ? "Синхронизирован с участником" : "Внешний помощник"}
              </Text>
              <Text style={styles.helper}>
                participantId: {executor.participantId ?? "—"}
              </Text>
              <Text style={styles.helper}>{executor.id}</Text>
            </SoftCard>
          ))}

          {(databaseSnapshot?.categories ?? []).map((category) => (
            <SoftCard key={`db-category-${category.id}`} accentColor={category.color}>
              <Badge label="categories" tone="neutral" />
              <Text style={styles.categoryName}>{category.name}</Text>
              <Text style={styles.helper}>
                {typeLabel[category.itemType]} · {category.id}
              </Text>
            </SoftCard>
          ))}

          {(databaseSnapshot?.accountConnections ?? []).map((accountConnection) => (
            <SoftCard key={`db-account-${accountConnection.id}`} accentColor="#C7D2FE">
              <Badge label="account_connections" tone="neutral" />
              <Text style={styles.categoryName}>{accountConnection.displayName}</Text>
              <Text style={styles.helper}>
                {providerLabel[accountConnection.provider]} · {accountConnection.accountEmail}
              </Text>
              <Text style={styles.helper}>{accountConnection.id}</Text>
            </SoftCard>
          ))}

          {(databaseSnapshot?.tasks ?? []).map((item) => (
            <SoftCard key={`db-task-${item.id}`} accentColor={item.itemType === "SHOPPING" ? "#FED7AA" : item.itemType === "EVENT" ? "#BFDBFE" : "#BBF7D0"}>
              <Badge label="tasks" tone="neutral" />
              <Text style={styles.categoryName}>{item.title}</Text>
              <Text style={styles.helper}>
                {typeLabel[item.itemType]} · {statusLabel[item.status]} · {priorityLabel[item.priority]}
              </Text>
              <Text style={styles.helper}>
                Исполнители: {item.assigneeNames.length ? item.assigneeNames.join(", ") : "—"}
              </Text>
              <Text style={styles.helper}>{item.id}</Text>
            </SoftCard>
          ))}
        </View>
      </ScrollView>

      <FamilyCreateModal
        visible={createFamilyVisible}
        form={createFamilyForm}
        onClose={() => setCreateFamilyVisible(false)}
        onChange={setCreateFamilyForm}
        onSubmit={() => createFamilyMutation.mutate()}
      />

      <ParticipantModal
        visible={participantVisible}
        form={participantForm}
        onClose={closeParticipantEditor}
        onChange={setParticipantForm}
        onSubmit={submitParticipant}
        onDelete={
          participantForm?.id
            ? async () => {
                await deleteParticipantMutation.mutateAsync(participantForm.id!);
              }
            : undefined
        }
      />

      <ExecutorModal
        visible={executorVisible}
        form={executorForm}
        onClose={closeExecutorEditor}
        onChange={setExecutorForm}
        onSubmit={submitExecutor}
        onDelete={
          executorForm?.id
            ? async () => {
                await deleteExecutorMutation.mutateAsync(executorForm.id!);
              }
            : undefined
        }
      />

      <CategoryModal
        visible={categoryVisible}
        form={categoryForm}
        onClose={closeCategoryEditor}
        onChange={setCategoryForm}
        onSubmit={submitCategory}
        onDelete={
          categoryForm?.id
            ? async () => {
                await deleteCategoryMutation.mutateAsync(categoryForm.id!);
              }
            : undefined
        }
      />

      <AccountConnectionModal
        visible={accountVisible}
        form={accountForm}
        onClose={closeAccountEditor}
        onChange={setAccountForm}
        onSubmit={submitAccountConnection}
        onDelete={
          accountForm?.id
            ? async () => {
                await deleteAccountConnectionMutation.mutateAsync(accountForm.id!);
              }
            : undefined
        }
      />
    </ScreenShell>
  );
}

function FamilyCreateModal(props: {
  visible: boolean;
  form: FamilyCreateState;
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<FamilyCreateState>>;
  onSubmit: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={props.visible} onRequestClose={props.onClose}>
      <ModalShell title="Новая семья" onClose={props.onClose}>
        <View>
          <FieldLabel>Название</FieldLabel>
          <Input
            value={props.form.familyName}
            onChangeText={(value) => props.onChange((current) => ({ ...current, familyName: value }))}
            placeholder="Например, ДомВместе"
          />
        </View>

        <View>
          <FieldLabel>Первый владелец</FieldLabel>
          <Input
            value={props.form.ownerName}
            onChangeText={(value) => props.onChange((current) => ({ ...current, ownerName: value }))}
            placeholder="Имя родителя"
          />
        </View>

        <FieldBlock
          label="Часовой пояс"
          content={
            <Picker
              selectedValue={props.form.timezone}
              onValueChange={(value) => props.onChange((current) => ({ ...current, timezone: String(value) }))}
            >
              {commonTimezones.map((timezone) => (
                <Picker.Item key={timezone} label={timezone} value={timezone} />
              ))}
            </Picker>
          }
        />

        <View style={styles.actionStack}>
          <PrimaryButton label="Создать семью" onPress={props.onSubmit} />
          <PrimaryButton label="Закрыть" onPress={props.onClose} tone="light" />
        </View>
      </ModalShell>
    </Modal>
  );
}

function ParticipantModal(props: {
  visible: boolean;
  form: ParticipantFormState | null;
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<ParticipantFormState | null>>;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={props.visible} onRequestClose={props.onClose}>
      <ModalShell title={props.form?.id ? "Участник" : "Новый участник"} onClose={props.onClose}>
        <View>
          <FieldLabel>Имя</FieldLabel>
          <Input
            value={props.form?.displayName ?? ""}
            onChangeText={(value) =>
              props.onChange((current) => (current ? { ...current, displayName: value } : current))
            }
            placeholder="Например, Саша"
          />
        </View>

        <FieldBlock
          label="Роль"
          content={
            <Picker
              selectedValue={props.form?.role}
              onValueChange={(value) =>
                props.onChange((current) => (current ? { ...current, role: value as FamilyRole } : current))
              }
            >
              <Picker.Item label="Родитель" value="PARENT" />
              <Picker.Item label="Ребёнок" value="CHILD" />
            </Picker>
          }
        />

        <FieldBlock
          label="Цвет"
          content={
            <Picker
              selectedValue={props.form?.color}
              onValueChange={(value) =>
                props.onChange((current) => (current ? { ...current, color: String(value) } : current))
              }
            >
              {colorOptions.map((color) => (
                <Picker.Item key={color} label={color} value={color} />
              ))}
            </Picker>
          }
        />

        <Text style={styles.helper}>После создания или удаления участника его исполнитель синхронизируется автоматически.</Text>

        <View style={styles.actionStack}>
          <PrimaryButton label={props.form?.id ? "Сохранить участника" : "Добавить участника"} onPress={props.onSubmit} />
          {props.onDelete ? <PrimaryButton label="Удалить участника" onPress={props.onDelete} tone="danger" /> : null}
          <PrimaryButton label="Закрыть" onPress={props.onClose} tone="light" />
        </View>
      </ModalShell>
    </Modal>
  );
}

function ExecutorModal(props: {
  visible: boolean;
  form: ExecutorFormState | null;
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<ExecutorFormState | null>>;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={props.visible} onRequestClose={props.onClose}>
      <ModalShell title={props.form?.id ? "Помощник" : "Новый помощник"} onClose={props.onClose}>
        <View>
          <FieldLabel>Имя помощника</FieldLabel>
          <Input
            value={props.form?.displayName ?? ""}
            onChangeText={(value) =>
              props.onChange((current) => (current ? { ...current, displayName: value, kind: "EXTERNAL_HELPER" } : current))
            }
            placeholder="Например, Няня"
          />
        </View>

        <Text style={styles.helper}>Связанный участник больше не настраивается здесь. Этот раздел только для внешних помощников.</Text>

        <View style={styles.actionStack}>
          <PrimaryButton label={props.form?.id ? "Сохранить помощника" : "Добавить помощника"} onPress={props.onSubmit} />
          {props.onDelete ? <PrimaryButton label="Удалить помощника" onPress={props.onDelete} tone="danger" /> : null}
          <PrimaryButton label="Закрыть" onPress={props.onClose} tone="light" />
        </View>
      </ModalShell>
    </Modal>
  );
}

function CategoryModal(props: {
  visible: boolean;
  form: CategoryFormState | null;
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<CategoryFormState | null>>;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={props.visible} onRequestClose={props.onClose}>
      <ModalShell title={props.form?.id ? "Категория" : "Новая категория"} onClose={props.onClose}>
        <View>
          <FieldLabel>Название</FieldLabel>
          <Input
            value={props.form?.name ?? ""}
            onChangeText={(value) =>
              props.onChange((current) => (current ? { ...current, name: value } : current))
            }
            placeholder="Например, Учёба"
          />
        </View>

        <FieldBlock
          label="Тип"
          content={
            <Picker
              selectedValue={props.form?.itemType}
              onValueChange={(value) =>
                props.onChange((current) => (current ? { ...current, itemType: value as PlannerItemType } : current))
              }
            >
              <Picker.Item label="Задачи" value="TASK" />
              <Picker.Item label="События" value="EVENT" />
              <Picker.Item label="Покупки" value="SHOPPING" />
            </Picker>
          }
        />

        <FieldBlock
          label="Цвет"
          content={
            <Picker
              selectedValue={props.form?.color}
              onValueChange={(value) =>
                props.onChange((current) => (current ? { ...current, color: String(value) } : current))
              }
            >
              {colorOptions.map((color) => (
                <Picker.Item key={color} label={color} value={color} />
              ))}
            </Picker>
          }
        />

        <View style={styles.actionStack}>
          <PrimaryButton label={props.form?.id ? "Сохранить категорию" : "Добавить категорию"} onPress={props.onSubmit} />
          {props.onDelete ? <PrimaryButton label="Удалить категорию" onPress={props.onDelete} tone="danger" /> : null}
          <PrimaryButton label="Закрыть" onPress={props.onClose} tone="light" />
        </View>
      </ModalShell>
    </Modal>
  );
}

function AccountConnectionModal(props: {
  visible: boolean;
  form: AccountConnectionFormState | null;
  onClose: () => void;
  onChange: React.Dispatch<React.SetStateAction<AccountConnectionFormState | null>>;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={props.visible} onRequestClose={props.onClose}>
      <ModalShell title={props.form?.id ? "Аккаунт" : "Подключить аккаунт"} onClose={props.onClose}>
        <FieldBlock
          label="Провайдер"
          content={
            <Picker
              selectedValue={props.form?.provider}
              onValueChange={(value) =>
                props.onChange((current) => (current ? { ...current, provider: value as AccountProvider } : current))
              }
            >
              <Picker.Item label="Google" value="GOOGLE" />
              <Picker.Item label="Apple" value="APPLE" />
              <Picker.Item label="Telegram" value="TELEGRAM" />
            </Picker>
          }
        />

        <View>
          <FieldLabel>Название</FieldLabel>
          <Input
            value={props.form?.displayName ?? ""}
            onChangeText={(value) =>
              props.onChange((current) => (current ? { ...current, displayName: value } : current))
            }
            placeholder="Например, Семейный Google"
          />
        </View>

        <View>
          <FieldLabel>Email / логин</FieldLabel>
          <Input
            value={props.form?.accountEmail ?? ""}
            onChangeText={(value) =>
              props.onChange((current) => (current ? { ...current, accountEmail: value } : current))
            }
            placeholder="family@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.actionStack}>
          <PrimaryButton label={props.form?.id ? "Сохранить аккаунт" : "Подключить аккаунт"} onPress={props.onSubmit} />
          {props.onDelete ? <PrimaryButton label="Удалить аккаунт" onPress={props.onDelete} tone="danger" /> : null}
          <PrimaryButton label="Закрыть" onPress={props.onClose} tone="light" />
        </View>
      </ModalShell>
    </Modal>
  );
}

function ModalShell(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.modalSheet}>
        <ScrollView contentContainerStyle={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{props.title}</Text>
            <Pressable onPress={props.onClose} style={styles.closeButton}>
              <Ionicons color={palette.ink} name="close" size={20} />
            </Pressable>
          </View>
          {props.children}
        </ScrollView>
      </View>
    </View>
  );
}

function FieldBlock(props: { label: string; content: React.ReactNode }) {
  return (
    <View>
      <FieldLabel>{props.label}</FieldLabel>
      <View style={styles.pickerWrap}>{props.content}</View>
    </View>
  );
}

async function invalidateFamily(queryClient: ReturnType<typeof useQueryClient>, familyId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["overview", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["family-settings", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["preferences", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["database-snapshot", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["calendar", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["tasks", familyId] }),
    queryClient.invalidateQueries({ queryKey: ["shopping", familyId] })
  ]);
}

const typeLabel = {
  TASK: "Задачи",
  EVENT: "События",
  SHOPPING: "Покупки"
};

const priorityLabel = {
  LOW: "Спокойно",
  MEDIUM: "Средний",
  HIGH: "Срочно"
};

const statusLabel = {
  NEW: "Новое",
  IN_PROGRESS: "В работе",
  DONE: "Готово",
  CANCELLED: "Отменено"
};

const providerLabel = {
  GOOGLE: "Google",
  APPLE: "Apple",
  TELEGRAM: "Telegram"
};

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: 56
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.84)",
    alignItems: "center",
    justifyContent: "center"
  },
  topTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  headerLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md
  },
  inviteLabel: {
    color: palette.slate,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700"
  },
  inviteValue: {
    color: palette.ink,
    fontSize: 30,
    letterSpacing: 2,
    fontWeight: "800",
    marginTop: spacing.sm
  },
  inviteNote: {
    color: palette.slate,
    marginTop: spacing.sm,
    lineHeight: 20
  },
  formBlock: {
    marginTop: spacing.md
  },
  stack: {
    gap: spacing.md
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  editableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  inlineAction: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#EEF4FB",
    alignItems: "center",
    justifyContent: "center"
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 999
  },
  textWrap: {
    flex: 1
  },
  name: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  role: {
    color: palette.slate,
    marginTop: 4
  },
  noteTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800"
  },
  noteText: {
    color: palette.slate,
    marginTop: 8,
    lineHeight: 20
  },
  categoryName: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 12
  },
  helper: {
    color: palette.slate,
    marginTop: 4,
    lineHeight: 20
  },
  pickerWrap: {
    borderRadius: 16,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#DDE7F2",
    overflow: "hidden"
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10,25,47,0.38)",
    justifyContent: "flex-end"
  },
  modalSheet: {
    maxHeight: "86%",
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
  actionStack: {
    gap: 10,
    marginTop: 8
  }
});
