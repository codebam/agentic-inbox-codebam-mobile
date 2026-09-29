import { Redirect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/lib/session";
import { tokenPreview } from "@/lib/token";

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.value} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

export default function SettingsScreen() {
  const { session, signOut } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const disconnect = useCallback(async () => {
    setConfirmOpen(false);
    await signOut();
    router.replace("/connect");
  }, [signOut, router]);

  if (!session) return <Redirect href="/connect" />;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <InfoRow
          label="Key"
          value={session.kind === "app" ? "Global key (every mailbox)" : "Scoped key (one mailbox)"}
        />
        <InfoRow label="Secret" value={tokenPreview(session.token)} />
        {session.mailboxId ? <InfoRow label="Mailbox" value={session.mailboxId} /> : null}
        <InfoRow label="Server" value={session.baseUrl} />
      </View>

      <View style={styles.disconnectWrap}>
        <Pressable
          onPress={() => setConfirmOpen(true)}
          style={({ pressed }) => [
            styles.disconnect,
            { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            Disconnect
          </ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          Disconnecting removes the key from this device. Revoke it in the inbox&apos;s web UI to cut
          off access for good.
        </ThemedText>
      </View>

      <ConfirmDialog
        visible={confirmOpen}
        title="Disconnect?"
        message="The key will be removed from this device."
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void disconnect()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  card: {
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
  },
  row: {
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  value: {
    fontWeight: 600,
  },
  disconnectWrap: {
    gap: Spacing.two,
  },
  disconnect: {
    borderRadius: 12,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
  note: {
    lineHeight: 19,
    paddingHorizontal: Spacing.two,
  },
});
