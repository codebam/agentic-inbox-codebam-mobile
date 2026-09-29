import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";

import { Banner } from "@/components/banner";
import { EmailRow } from "@/components/email-row";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSearch } from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function SearchScreen() {
  const params = useLocalSearchParams<{ mailboxId?: string }>();
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");

  const paramMailbox = typeof params.mailboxId === "string" && params.mailboxId ? params.mailboxId : null;
  const sessionMailbox = session?.kind === "mailbox" ? session.mailboxId : null;
  // A null target searches every mailbox, which only a global key may do.
  const targetMailbox = paramMailbox ?? sessionMailbox;

  const results = useSearch(api, targetMailbox, { query: submitted, limit: 50 });

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;

  const global = targetMailbox === null;
  const rows = results.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: global ? "Search all mailboxes" : "Search" }} />
      <View style={[styles.searchRow, { backgroundColor: theme.backgroundElement }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => setSubmitted(text.trim())}
          placeholder={global ? "Search every mailbox…" : "Search this mailbox…"}
          placeholderTextColor={theme.textSecondary}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
          accessibilityLabel="Search query"
        />
        <Pressable
          onPress={() => setSubmitted(text.trim())}
          hitSlop={10}
          accessibilityRole="button"
          style={({ pressed }) => [styles.go, { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 }]}>
          <ThemedText type="smallBold" style={styles.goLabel}>
            Search
          </ThemedText>
        </Pressable>
      </View>

      {results.error ? (
        <View style={styles.bannerWrap}>
          <Banner message={results.error instanceof Error ? results.error.message : "Search failed."} />
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => `${item.mailboxId ?? ""}:${item.id}`}
        renderItem={({ item }) => (
          <EmailRow
            email={item}
            showFolder
            onPress={() => {
              const target = item.mailboxId ?? targetMailbox;
              if (!target) return;
              router.push({
                pathname: "/m/[mailboxId]/e/[emailId]",
                params: { mailboxId: target, emailId: item.id },
              });
            }}
          />
        )}
        ListEmptyComponent={
          results.isLoading ? (
            <Loading label="Searching…" />
          ) : submitted ? (
            <EmptyState icon="search-outline" title="No matches" message={`Nothing found for "${submitted}".`} />
          ) : (
            <EmptyState
              icon="search-outline"
              title="Search mail"
              message={global ? "Searches subject, body and people across every mailbox." : "Searches subject, body and people in this mailbox."}
            />
          )
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    margin: Spacing.three,
    borderRadius: 12,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 10,
  },
  go: {
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
  },
  goLabel: {
    color: "#ffffff",
  },
  bannerWrap: {
    paddingHorizontal: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
  },
});
