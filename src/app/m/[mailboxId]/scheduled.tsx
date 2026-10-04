import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { ScheduledSend } from "@/lib/api";
import { formatFullDate } from "@/lib/format";
import { useCancelScheduledSend, useRetryScheduledSend, useScheduledSends } from "@/lib/queries";
import { useSession } from "@/lib/session";

const STATUS_COPY: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

function recipientText(payload: ScheduledSend["payload"]): string {
  const to = payload?.to;
  if (!to) return "(unknown recipient)";
  return Array.isArray(to) ? to.join(", ") : to;
}

/** The mailbox's scheduled sends: watch the queue, cancel pending, retry failed. */
export default function ScheduledScreen() {
  const { mailboxId } = useLocalSearchParams<{ mailboxId: string }>();
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const mailbox = mailboxId ?? "";
  const query = useScheduledSends(api, mailbox);
  const cancelSend = useCancelScheduledSend(api, mailbox);
  const retrySend = useRetryScheduledSend(api, mailbox);

  const [confirmCancel, setConfirmCancel] = useState<ScheduledSend | null>(null);
  const [confirmRetry, setConfirmRetry] = useState<ScheduledSend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailbox;
  if (!mailbox || (session.kind === "mailbox" && mailbox !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  const fail = (err: unknown) => {
    setNotice(null);
    setError(err instanceof Error ? err.message : "The action failed.");
  };

  const statusColor = (status: string): string => {
    if (status === "failed") return theme.danger;
    if (status === "pending") return theme.tint;
    return theme.textSecondary;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Scheduled sends" }} />
      {notice ? (
        <View style={styles.bannerWrap}>
          <Banner message={notice} tone="success" />
        </View>
      ) : null}
      {error ? (
        <View style={styles.bannerWrap}>
          <Banner message={error} />
        </View>
      ) : null}
      {query.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={
              query.error instanceof Error ? query.error.message : "Couldn't load the queue."
            }
          />
        </View>
      ) : null}
      <FlatList
        data={query.data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={theme.textSecondary}
          />
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { borderBottomColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold" style={styles.subject} numberOfLines={1}>
                {item.payload?.subject?.trim() || "(no subject)"}
              </ThemedText>
              <ThemedText type="small" style={{ color: statusColor(item.status) }}>
                {STATUS_COPY[item.status] ?? item.status}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              To {recipientText(item.payload)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.status === "sent" && item.sent_at
                ? `Sent ${formatFullDate(item.sent_at)}`
                : `Due ${formatFullDate(item.send_at)}`}
            </ThemedText>
            {item.last_error ? (
              <ThemedText type="small" style={{ color: theme.danger }} numberOfLines={2}>
                {item.last_error}
              </ThemedText>
            ) : null}
            {item.status === "pending" ? (
              <Pressable
                onPress={() => setConfirmCancel(item)}
                style={({ pressed }) => [
                  styles.rowButton,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                ]}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  Cancel send
                </ThemedText>
              </Pressable>
            ) : null}
            {item.status === "failed" ? (
              <Pressable
                onPress={() => setConfirmRetry(item)}
                style={({ pressed }) => [
                  styles.rowButton,
                  { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                ]}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  Retry now
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <Loading label="Loading the queue…" />
          ) : (
            <EmptyState
              icon="time-outline"
              title="Nothing scheduled"
              message="Messages queued with “Send later” wait here until they go out."
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <ConfirmDialog
        visible={confirmCancel !== null}
        title="Cancel this send?"
        message={
          confirmCancel
            ? `“${confirmCancel.payload?.subject?.trim() || "(no subject)"}” will not be sent. The row stays for the record.`
            : undefined
        }
        confirmLabel="Cancel send"
        destructive
        busy={cancelSend.isPending}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => {
          const target = confirmCancel;
          if (!target) return;
          cancelSend.mutate(target.id, {
            onSuccess: () => {
              setConfirmCancel(null);
              setNotice("The send was cancelled.");
            },
            onError: (err) => {
              setConfirmCancel(null);
              fail(err);
            },
          });
        }}
      />

      <ConfirmDialog
        visible={confirmRetry !== null}
        title="Retry this send?"
        message={
          confirmRetry
            ? `“${confirmRetry.payload?.subject?.trim() || "(no subject)"}” is re-armed and goes out as soon as the mailbox processes it.`
            : undefined
        }
        confirmLabel="Retry"
        busy={retrySend.isPending}
        onCancel={() => setConfirmRetry(null)}
        onConfirm={() => {
          const target = confirmRetry;
          if (!target) return;
          retrySend.mutate(target.id, {
            onSuccess: () => {
              setConfirmRetry(null);
              setNotice("The send is pending again.");
            },
            onError: (err) => {
              setConfirmRetry(null);
              fail(err);
            },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bannerWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  card: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.one,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  subject: {
    flex: 1,
  },
  rowButton: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    marginTop: Spacing.one,
  },
  listContent: {
    flexGrow: 1,
  },
});
