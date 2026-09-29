import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { Platform, useColorScheme } from "react-native";

import { useTheme } from "@/hooks/use-theme";
import { SessionProvider } from "@/lib/session";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? DarkTheme : DefaultTheme;
  const appTheme = useTheme();

  // Keep the Android window behind every screen the same colour as the
  // screens themselves: a white window shows through as a flash whenever a
  // screen pops, most visibly over the message view's dark WebView.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void SystemUI.setBackgroundColorAsync(appTheme.background).catch(() => {});
  }, [appTheme.background]);

  return (
    <ThemeProvider value={theme}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.card },
              headerTintColor: theme.colors.text,
              contentStyle: { backgroundColor: appTheme.background },
            }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="connect" options={{ headerShown: false }} />
            <Stack.Screen name="m/index" options={{ title: "Mailboxes" }} />
            <Stack.Screen name="m/[mailboxId]/index" options={{ title: "Folders" }} />
            <Stack.Screen name="m/[mailboxId]/f/[folder]" options={{ title: "Messages" }} />
            <Stack.Screen name="m/[mailboxId]/e/[emailId]" options={{ title: "Message" }} />
            <Stack.Screen name="m/[mailboxId]/t/[threadId]" options={{ title: "Thread" }} />
            <Stack.Screen name="search" options={{ title: "Search" }} />
            <Stack.Screen name="compose" options={{ title: "Compose" }} />
            <Stack.Screen name="settings" options={{ title: "Settings" }} />
          </Stack>
        </SessionProvider>
      </QueryClientProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
