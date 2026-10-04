import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, View } from "react-native";

import { Banner } from "@/components/banner";
import { EmailRow } from "@/components/email-row";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { ThreadSummary } from "@/lib/api";
import { truncate } from "@/lib/format";
import { useMarkThreadRead, useMuteThread, useSummarizeThread, useThread } from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function ThreadScreen() {
  const { mailboxId, threadId } = useLocalSearchParams<{ mailboxId: string; threadId: string }>();
  const mailbox = mailboxId ?? "";
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const query = useThread(api, mailbox, threadId ?? "");
  const muteThread = useMuteThread(api, mailbox);
  const markThreadRead = useMarkThreadRead(api, mailbox);
  const summarize = useSummarizeThread(api, mailbox);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ThreadSummary | null>(null);

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailbox;
  if (!mailbox || (session.kind === "mailbox" && mailbox !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  const messages = query.data?.messages ?? [];
  const title = truncate(messages[0]?.subject?.trim() || "Thread", 42);
  const muted = query.data?.muted ?? false;

  const fail = (error: unknown) => {
    setNotice(null);
    setActionError(error instanceof Error ? error.message : "The action failed.");
  };

  const toggleMute = () => {
    if (!threadId) return;
    setActionError(null);
    muteThread.mutate(
      { threadId, muted: !muted },
      {
        onSuccess: () =>
          setNotice(muted ? "Thread unmuted." : "Thread muted — new mail in it stays quiet."),
        onError: fail,
      },
    );
  };

  const markRead = () => {
    if (!threadId) return;
    setActionError(null);
    markThreadRead.mutate(threadId, {
      onSuccess: () => setNotice("Thread marked read."),
      onError: fail,
    });
  };

  const runSummary = () => {
    if (!threadId) return;
    setActionError(null);
    summarize.mutate(threadId, { onSuccess: setSummary, onError: fail });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderIconButton
                name={muted ? "notifications-off-outline" : "notifications-outline"}
                label={muted ? "Unmute thread" : "Mute thread"}
                onPress={toggleMute}
              />
              <HeaderIconButton
                name="checkmark-done-outline"
                label="Mark thread read"
                onPress={markRead}
              />
              <HeaderIconButton
                name="sparkles-outline"
                label="Summarize thread"
                onPress={runSummary}
              />
            </View>
          ),
        }}
      />
      {notice ? (
        <View style={styles.bannerWrap}>
          <Banner message={notice} tone="success" />
        </View>
      ) : null}
      {actionError ? (
        <View style={styles.bannerWrap}>
          <Banner message={actionError} />
        </View>
      ) : null}
      {query.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={
              query.error instanceof Error ? query.error.message : "Couldn't load the thread."
            }
          />
        </View>
      ) : null}
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          messages.length > 0 ? (
            <View style={styles.countWrap}>
              <ThemedText type="small" themeColor="textSecondary">
                {messages.length} {messages.length === 1 ? "message" : "messages"} in this thread
                {muted ? " · Muted" : ""}
              </ThemedText>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <EmailRow
            email={item}
            showFolder
            onPress={() =>
              router.push({
                pathname: "/m/[mailboxId]/e/[emailId]",
                params: { mailboxId: mailbox, emailId: item.id },
              })
            }
          />
        )}
        ListEmptyComponent={query.isLoading ? <Loading label="Loading thread…" /> : null}
        contentContainerStyle={styles.listContent}
      />

      <Modal
        visible={summary !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSummary(null)}>
        <View style={styles.backdrop}>
          <View
            style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="sparkles-outline" size={16} color={theme.tint} />
              <ThemedText type="smallBold">Thread summary</ThemedText>
            </View>
            <ThemedText type="small" selectable style={styles.summaryText}>
              {summary?.text ?? ""}
            </ThemedText>
            {summary ? (
              <ThemedText type="small" themeColor="textSecondary">
                {summary.message_count} {summary.message_count === 1 ? "message" : "messages"} ·{" "}
                {summary.model}
                {summary.truncated ? " · shortened for length" : ""}
              </ThemedText>
            ) : null}
            <Pressable
              onPress={() => setSummary(null)}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
              ]}>
              <ThemedText type="smallBold">Close</ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingRight: Spacing.two,
  },
  bannerWrap: {
    padding: Spacing.three,
  },
  countWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "80%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  summaryText: {
    lineHeight: 20,
  },
  closeButton: {
    alignSelf: "flex-end",
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
});
