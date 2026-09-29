import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Banner } from "@/components/banner";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, createSession, DEFAULT_SERVER_URL, ScopedApi } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function ConnectScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { signIn, session, ready } = useSession();

  const [key, setKey] = useState("");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [showServer, setShowServer] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    const next = createSession(serverUrl, key);
    if (!next) {
      setError("That doesn't look like an inbox key. Expected ain1_ (one mailbox) or ain2_ (all mailboxes).");
      return;
    }
    setBusy(true);
    try {
      const client = new ScopedApi(next);
      if (next.kind === "app") {
        await client.listMailboxes();
      } else if (next.mailboxId) {
        await client.listEmails(next.mailboxId, "inbox", { limit: 1, page: 1 });
      }
      await signIn(next);
      router.replace("/m");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't connect. Check the key and server URL.");
    } finally {
      setBusy(false);
    }
  }, [key, serverUrl, signIn, router]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: theme.backgroundElement }]}>
            <Ionicons name="mail" size={34} color={theme.tint} />
          </View>
          <ThemedText type="subtitle" style={styles.title}>
            Agentic Inbox Codebam
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            Read, search and reply from your phone. Connect with an access key minted in your inbox.
          </ThemedText>

          {ready && session ? (
            <Pressable
              onPress={() => router.replace("/m")}
              style={[styles.continueRow, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small" numberOfLines={1} style={styles.flex}>
                Connected to {session.baseUrl.replace(/^https?:\/\//, "")}
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Continue
              </ThemedText>
            </Pressable>
          ) : null}

          <View style={styles.form}>
            <ThemedText type="smallBold">Access key</ThemedText>
            <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement }]}>
              <TextInput
                value={key}
                onChangeText={setKey}
                placeholder="ain1_… or ain2_…"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                secureTextEntry={!showKey}
                style={[styles.input, { color: theme.text }]}
                accessibilityLabel="Access key"
              />
              <Pressable onPress={() => setShowKey((value) => !value)} hitSlop={10} accessibilityRole="button">
                <Ionicons name={showKey ? "eye-off-outline" : "eye-outline"} size={20} color={theme.textSecondary} />
              </Pressable>
            </View>

            <Pressable onPress={() => setShowServer((value) => !value)} hitSlop={8} style={styles.advancedRow}>
              <Ionicons name={showServer ? "chevron-down" : "chevron-forward"} size={16} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                Server
              </ThemedText>
            </Pressable>
            {showServer ? (
              <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement }]}>
                <TextInput
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  placeholder={DEFAULT_SERVER_URL}
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={[styles.input, { color: theme.text }]}
                  accessibilityLabel="Server URL"
                />
              </View>
            ) : null}

            {error ? <Banner message={error} /> : null}

            <Pressable
              onPress={() => void connect()}
              disabled={busy || key.trim().length === 0}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.tint, opacity: busy || key.trim().length === 0 ? 0.5 : pressed ? 0.85 : 1 },
              ]}>
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  Connect
                </ThemedText>
              )}
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.help}>
            Mint a global key in Global Settings, App access tokens (reaches every mailbox), or a
            per-mailbox key under a mailbox&apos;s Settings, Access tokens. The key is stored in this
            device&apos;s secure storage and sent only to your inbox server.
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.four,
  },
  title: {
    marginTop: Spacing.two,
  },
  subtitle: {
    lineHeight: 20,
  },
  continueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  form: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  advancedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: Spacing.two,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginTop: Spacing.two,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 15,
  },
  help: {
    marginTop: Spacing.two,
    lineHeight: 19,
  },
});
