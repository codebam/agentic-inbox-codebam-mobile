import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, StyleSheet, View } from "react-native";

import { Banner } from "@/components/banner";
import { EmailRow } from "@/components/email-row";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { truncate } from "@/lib/format";
import { useThread } from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function ThreadScreen() {
  const { mailboxId, threadId } = useLocalSearchParams<{ mailboxId: string; threadId: string }>();
  const mailbox = mailboxId ?? "";
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const query = useThread(api, mailbox, threadId ?? "");

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailbox;
  if (!mailbox || (session.kind === "mailbox" && mailbox !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  const messages = query.data?.messages ?? [];
  const title = truncate(messages[0]?.subject?.trim() || "Thread", 42);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title }} />
      {query.error ? (
        <View style={styles.bannerWrap}>
          <Banner message={query.error instanceof Error ? query.error.message : "Couldn't load the thread."} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
});
