import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade_from_bottom"
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="family"
          options={{
            presentation: "card",
            animation: "slide_from_right"
          }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
