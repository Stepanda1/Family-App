import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { palette, spacing } from "../lib/theme";

export function ScreenShell(props: { children: React.ReactNode }) {
  return (
    <LinearGradient colors={["#FFF9F1", "#F5FBFF", "#EFF4FF"]} style={styles.shell}>
      <View style={styles.orbA} />
      <View style={styles.orbB} />
      {props.children}
    </LinearGradient>
  );
}

export function HeroCard(props: {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  onActionPress?: () => void;
}) {
  return (
    <View style={styles.heroWrap}>
      <LinearGradient colors={["#0C2340", "#183F73", "#2B5DAA"]} style={styles.hero}>
        <Text style={styles.eyebrow}>{props.eyebrow}</Text>
        <Text style={styles.heroTitle}>{props.title}</Text>
        <Text style={styles.heroDescription}>{props.description}</Text>
        {props.actionLabel ? (
          <Pressable onPress={props.onActionPress} style={styles.heroButton}>
            <Text style={styles.heroButtonText}>{props.actionLabel}</Text>
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}

export function SectionTitle(props: { title: string; caption?: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.caption ? <Text style={styles.sectionCaption}>{props.caption}</Text> : null}
    </View>
  );
}

export function SoftCard(props: {
  children: React.ReactNode;
  onPress?: () => void;
  accentColor?: string;
}) {
  const content = (
    <View style={[styles.softCard, props.accentColor ? { borderColor: props.accentColor } : null]}>{props.children}</View>
  );

  if (!props.onPress) {
    return content;
  }

  return <Pressable onPress={props.onPress}>{content}</Pressable>;
}

export function Badge(props: { label: string; tone: "info" | "warning" | "success" | "neutral" }) {
  const backgroundColor =
    props.tone === "warning"
      ? "#FFF1E8"
      : props.tone === "success"
        ? "#EAFBF1"
        : props.tone === "neutral"
          ? "#EEF2F8"
          : "#EAF5FF";
  const color =
    props.tone === "warning"
      ? palette.orange
      : props.tone === "success"
        ? palette.green
        : props.tone === "neutral"
          ? palette.slate
          : palette.blue;

  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.badgeText, { color }]}>{props.label}</Text>
    </View>
  );
}

export function PrimaryButton(props: { label: string; onPress: () => void; tone?: "dark" | "light" | "danger" }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.primaryButton,
        props.tone === "light" ? styles.primaryButtonLight : null,
        props.tone === "danger" ? styles.primaryButtonDanger : null
      ]}
    >
      <Text
        style={[
          styles.primaryButtonText,
          props.tone === "light" ? styles.primaryButtonTextLight : null,
          props.tone === "danger" ? styles.primaryButtonTextLight : null
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function FieldLabel(props: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{props.children}</Text>;
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor="#7A8BA3" {...props} style={[styles.input, props.style]} />;
}

const styles = StyleSheet.create({
  shell: {
    flex: 1
  },
  orbA: {
    position: "absolute",
    top: -60,
    right: -20,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(29,78,216,0.10)"
  },
  orbB: {
    position: "absolute",
    bottom: 120,
    left: -40,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "rgba(249,115,22,0.10)"
  },
  heroWrap: {
    borderRadius: 30
  },
  hero: {
    borderRadius: 30,
    padding: spacing.lg,
    gap: spacing.sm
  },
  eyebrow: {
    color: "#D9E8FF",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontWeight: "700"
  },
  heroTitle: {
    color: palette.paper,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800"
  },
  heroDescription: {
    color: "#E8F1FF",
    fontSize: 15,
    lineHeight: 22
  },
  heroButton: {
    alignSelf: "flex-start",
    backgroundColor: "#F8FBFF",
    borderRadius: 999,
    marginTop: spacing.sm,
    paddingHorizontal: 18,
    paddingVertical: 10
  },
  heroButtonText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "700"
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "800"
  },
  sectionCaption: {
    color: palette.slate,
    fontSize: 13,
    fontWeight: "600"
  },
  softCard: {
    backgroundColor: "rgba(255,255,255,0.94)",
    borderRadius: 24,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(16,42,67,0.06)",
    shadowColor: "#17406B",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700"
  },
  primaryButton: {
    backgroundColor: palette.ink,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonLight: {
    backgroundColor: "#EFF6FF"
  },
  primaryButtonDanger: {
    backgroundColor: "#FFF0F3"
  },
  primaryButtonText: {
    color: palette.paper,
    fontWeight: "800",
    fontSize: 15
  },
  primaryButtonTextLight: {
    color: palette.ink
  },
  fieldLabel: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8
  },
  input: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#F8FBFF",
    borderWidth: 1,
    borderColor: "#DDE7F2",
    color: palette.ink,
    fontSize: 15
  }
});
