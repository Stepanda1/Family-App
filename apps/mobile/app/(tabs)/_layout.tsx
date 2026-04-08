import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { palette } from "../../src/lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.blue,
        tabBarInactiveTintColor: "#6B7C93",
        sceneStyle: {
          backgroundColor: "transparent"
        },
        tabBarStyle: {
          height: 76,
          paddingBottom: 10,
          paddingTop: 8,
          borderTopWidth: 0,
          backgroundColor: "rgba(255,255,255,0.96)",
          position: "absolute"
        }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Дом",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="sparkles-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Календарь",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="calendar-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Списки",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="list-outline" size={size} />
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Настройки",
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="options-outline" size={size} />
        }}
      />
    </Tabs>
  );
}
