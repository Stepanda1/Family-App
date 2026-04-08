import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Badge, HeroCard, ScreenShell, SectionTitle, SoftCard } from "../../src/components/ui";
import { api } from "../../src/lib/api";
import { palette, spacing } from "../../src/lib/theme";
import { useFamilyStore } from "../../src/store/family-store";

export default function HomeScreen() {
  const familyId = useFamilyStore((state) => state.familyId);
  const overviewQuery = useQuery({
    queryKey: ["overview", familyId],
    queryFn: () => api.getOverview(familyId)
  });

  const overview = overviewQuery.data;

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.content}>
        <HeroCard
          eyebrow="ДомВместе"
          title="Семейные дела, события и покупки без путаницы"
          description="Общий ритм семьи: кто за что отвечает, что сегодня в календаре и какие задачи требуют внимания."
          actionLabel="Открыть настройки семьи"
          onActionPress={() => router.push("/family")}
        />

        <SoftCard accentColor="#DCEAFE">
          <View style={styles.familyHeader}>
            <View>
              <Text style={styles.familyName}>{overview?.family.name ?? "Семья"}</Text>
              <Text style={styles.familyMeta}>Код приглашения: {overview?.family.inviteCode ?? "..."}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push("/family")} style={styles.iconButton}>
              <Ionicons color={palette.ink} name="settings-outline" size={22} />
            </TouchableOpacity>
          </View>
          <View style={styles.membersRow}>
            {overview?.participants.map((participant, index) => (
              <View key={participant.id} style={[styles.memberPill, { borderColor: participant.color }]}>
                <View style={[styles.memberDot, { backgroundColor: participant.color }]} />
                <Text style={styles.memberText}>{participant.displayName}</Text>
              </View>
            ))}
          </View>
        </SoftCard>

        <SectionTitle title="Сегодня" caption="ближайшие события" />
        <View style={styles.stack}>
          {overview?.todayItems.map((item) => (
            <SoftCard key={item.id} accentColor="#DDEAFE">
              <Badge label={item.itemType === "EVENT" ? "Событие" : "План"} tone="info" />
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubline}>{item.assigneeNames.join(", ")}</Text>
              <Text style={styles.cardDate}>{formatDate(item.scheduledStartAt ?? item.dueAt)}</Text>
            </SoftCard>
          ))}
        </View>

        <SectionTitle title="Фокус дня" caption="что закрыть сегодня" />
        <View style={styles.stack}>
          {overview?.urgentItems.map((item) => (
            <SoftCard key={item.id} accentColor={item.priority === "HIGH" ? "#FECACA" : "#DBEAFE"}>
              <View style={styles.rowBetween}>
                <Badge
                  label={priorityLabel[item.priority]}
                  tone={item.priority === "HIGH" ? "warning" : "neutral"}
                />
                <Text style={styles.statusLabel}>{statusLabel[item.status]}</Text>
              </View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubline}>Ответственные: {item.assigneeNames.join(", ")}</Text>
              <Text style={styles.cardDate}>Дедлайн: {formatDate(item.dueAt)}</Text>
            </SoftCard>
          ))}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Без времени";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

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

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: 120
  },
  familyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  familyName: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "800"
  },
  familyMeta: {
    color: palette.slate,
    marginTop: 4,
    fontSize: 14
  },
  membersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md
  },
  memberPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFFFFF"
  },
  memberDot: {
    width: 10,
    height: 10,
    borderRadius: 999
  },
  memberText: {
    color: palette.ink,
    fontWeight: "600"
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center"
  },
  stack: {
    gap: spacing.md
  },
  cardTitle: {
    color: palette.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
    marginTop: spacing.sm
  },
  cardSubline: {
    color: palette.slate,
    marginTop: 4,
    fontSize: 14
  },
  cardDate: {
    color: palette.ink,
    marginTop: spacing.sm,
    fontSize: 14,
    fontWeight: "600"
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  statusLabel: {
    color: palette.slate,
    fontSize: 13,
    fontWeight: "700"
  }
});
