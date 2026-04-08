import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, HeroCard, ScreenShell, SectionTitle, SoftCard } from "../../src/components/ui";
import { api } from "../../src/lib/api";
import { palette, spacing } from "../../src/lib/theme";
import { useFamilyStore } from "../../src/store/family-store";

const weekLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export default function CalendarScreen() {
  const familyId = useFamilyStore((state) => state.familyId);
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const calendarQuery = useQuery({
    queryKey: ["calendar", familyId],
    queryFn: () => api.getCalendar(familyId)
  });

  const selectedMonth = useMemo(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
    [selectedDate]
  );

  const monthGrid = useMemo(() => buildMonthGrid(selectedMonth), [selectedMonth]);
  const events = calendarQuery.data ?? [];
  const dayEvents = useMemo(
    () => events.filter((item) => isSameDay(item.scheduledStartAt ?? item.dueAt, selectedDate)),
    [events, selectedDate]
  );

  return (
    <ScreenShell>
      <ScrollView contentContainerStyle={styles.content}>
        <HeroCard
          eyebrow="Календарь семьи"
          title="Месяц, даты и события на одном экране"
          description="Сразу видно, где у семьи плотные дни, какие события уже назначены и что попадает на выбранную дату."
        />

        <SoftCard accentColor="#DCEAFE">
          <View style={styles.monthHeader}>
            <Pressable onPress={() => setSelectedDate(startOfDay(addMonths(selectedMonth, -1)))} style={styles.arrowButton}>
              <Ionicons color={palette.ink} name="chevron-back" size={20} />
            </Pressable>
            <View style={styles.monthCenter}>
              <Text style={styles.monthTitle}>
                {selectedMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
              </Text>
              <Badge label={`${events.length} событий`} tone="info" />
            </View>
            <Pressable onPress={() => setSelectedDate(startOfDay(addMonths(selectedMonth, 1)))} style={styles.arrowButton}>
              <Ionicons color={palette.ink} name="chevron-forward" size={20} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {weekLabels.map((label) => (
              <Text key={label} style={styles.weekLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {monthGrid.map((date) => {
              const inMonth = date.getMonth() === selectedMonth.getMonth();
              const active = isSameDay(date.toISOString(), selectedDate);
              const hasEvents = events.some((item) => isSameDay(item.scheduledStartAt ?? item.dueAt, date));

              return (
                <Pressable
                  key={date.toISOString()}
                  onPress={() => setSelectedDate(startOfDay(date))}
                  style={[
                    styles.dayCell,
                    active && styles.dayCellActive,
                    !inMonth && styles.dayCellMuted
                  ]}
                >
                  <Text style={[styles.dayText, active && styles.dayTextActive, !inMonth && styles.dayTextMuted]}>
                    {date.getDate()}
                  </Text>
                  {hasEvents ? <View style={[styles.eventDot, active && styles.eventDotActive]} /> : null}
                </Pressable>
              );
            })}
          </View>
        </SoftCard>

        <SectionTitle
          title={selectedDate.toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long"
          })}
          caption={dayEvents.length ? `${dayEvents.length} события` : "день свободен"}
        />
        <View style={styles.stack}>
          {dayEvents.length ? (
            dayEvents.map((item) => (
              <SoftCard key={item.id} accentColor="#BFDBFE">
                <View style={styles.row}>
                  <Badge label={item.category ?? "Событие"} tone="info" />
                  <Text style={styles.time}>{formatTime(item.scheduledStartAt ?? item.dueAt)}</Text>
                </View>
                <Text style={styles.title}>{item.title}</Text>
                {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
                <Text style={styles.meta}>Участники: {item.assigneeNames.join(", ")}</Text>
                <Text style={styles.meta}>Место: {item.location ?? "Не указано"}</Text>
              </SoftCard>
            ))
          ) : (
            <SoftCard accentColor="#E5E7EB">
              <Text style={styles.emptyTitle}>На выбранную дату событий нет</Text>
              <Text style={styles.emptyText}>Здесь появятся семейные встречи, кружки, ужины и поездки.</Text>
            </SoftCard>
          )}
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildMonthGrid(monthDate: Date) {
  const monthStart = startOfDay(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
  const jsDay = monthStart.getDay();
  const mondayIndex = jsDay === 0 ? 6 : jsDay - 1;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayIndex);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function addMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

function isSameDay(value: string | Date | null | undefined, target: Date) {
  if (!value) {
    return false;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function formatTime(value?: string | null) {
  if (!value) {
    return "Без времени";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: 120
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md
  },
  monthCenter: {
    flex: 1,
    alignItems: "center",
    gap: 8
  },
  monthTitle: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "800",
    textTransform: "capitalize"
  },
  arrowButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#EEF4FB",
    alignItems: "center",
    justifyContent: "center"
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: spacing.sm
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    color: palette.slate,
    fontSize: 12,
    fontWeight: "700"
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  dayCell: {
    width: "12.8%",
    minWidth: 42,
    aspectRatio: 0.9,
    borderRadius: 16,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#E4ECF5",
    justifyContent: "center",
    alignItems: "center"
  },
  dayCellActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  dayCellMuted: {
    opacity: 0.45
  },
  dayText: {
    color: palette.ink,
    fontWeight: "700"
  },
  dayTextActive: {
    color: palette.paper
  },
  dayTextMuted: {
    color: palette.slate
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: palette.blue,
    marginTop: 4
  },
  eventDotActive: {
    backgroundColor: "#FCD34D"
  },
  stack: {
    gap: spacing.md
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  time: {
    color: palette.blue,
    fontSize: 13,
    fontWeight: "800"
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
  emptyTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800"
  },
  emptyText: {
    color: palette.slate,
    marginTop: 8,
    lineHeight: 20
  }
});
