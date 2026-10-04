import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";

import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmailRow } from "@/components/email-row";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { PromptDialog, type PromptField } from "@/components/prompt-dialog";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { SavedSearchRow } from "@/lib/api";
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearches,
  useSearch,
  useUpdateSavedSearch,
} from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function SearchScreen() {
  const params = useLocalSearchParams<{ mailboxId?: string }>();
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [prompt, setPrompt] = useState<
    { mode: "save" } | { mode: "rename"; search: SavedSearchRow } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<SavedSearchRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const paramMailbox =
    typeof params.mailboxId === "string" && params.mailboxId ? params.mailboxId : null;
  const sessionMailbox = session?.kind === "mailbox" ? session.mailboxId : null;
  // A null target searches every mailbox, which only a global key may do.
  const targetMailbox = paramMailbox ?? sessionMailbox;
  const global = targetMailbox === null;

  const results = useSearch(api, targetMailbox, { query: submitted, limit: 50 });
  // Saved searches live in one mailbox's store, so a global key has none.
  const saved = useSavedSearches(api, targetMailbox ?? "", !global);
  const createSaved = useCreateSavedSearch(api, targetMailbox ?? "");
  const updateSaved = useUpdateSavedSearch(api, targetMailbox ?? "");
  const deleteSaved = useDeleteSavedSearch(api, targetMailbox ?? "");

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;

  const rows = results.data ?? [];
  const searches = saved.data ?? [];

  const fail = (error: unknown) => {
    setNotice(null);
    setActionError(error instanceof Error ? error.message : "The action failed.");
  };

  const runSearch = (query: string) => {
    setText(query);
    setSubmitted(query.trim());
  };

  const fields: PromptField[] =
    prompt?.mode === "rename"
      ? [
          { key: "name", label: "Name", initial: prompt.search.name, autoFocus: true },
          { key: "query", label: "Query", initial: prompt.search.query },
        ]
      : [{ key: "name", label: "Name", autoFocus: true, placeholder: "Unread from boss" }];

  const submit = (values: Record<string, string>) => {
    const name = (values.name ?? "").trim();
    setActionError(null);
    if (!name) {
      fail(new Error("A saved search needs a name."));
      return;
    }
    if (prompt?.mode === "rename") {
      const query = (values.query ?? "").trim();
      if (!query) {
        fail(new Error("A saved search needs a query."));
        return;
      }
      const target = prompt.search;
      updateSaved.mutate(
        { searchId: target.id, name, query },
        {
          onSuccess: () => {
            setPrompt(null);
            setNotice(`Updated “${name}”.`);
          },
          onError: fail,
        },
      );
    } else {
      createSaved.mutate(
        { name, query: submitted },
        {
          onSuccess: () => {
            setPrompt(null);
            setNotice(`Saved “${name}”.`);
          },
          onError: fail,
        },
      );
    }
  };

  const savedRow = ({ item }: { item: SavedSearchRow }) => (
    <Pressable
      onPress={() => runSearch(item.query)}
      style={({ pressed }) => [
        styles.savedRow,
        {
          borderBottomColor: theme.border,
          backgroundColor: pressed ? theme.backgroundSelected : "transparent",
        },
      ]}>
      <View style={styles.savedText}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {item.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {item.query}
        </ThemedText>
      </View>
      <Pressable
        onPress={() => setPrompt({ mode: "rename", search: item })}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Rename ${item.name}`}>
        <Ionicons name="create-outline" size={18} color={theme.textSecondary} />
      </Pressable>
      <Pressable
        onPress={() => setConfirmDelete(item)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${item.name}`}>
        <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
      </Pressable>
    </Pressable>
  );

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

      {submitted && !global ? (
        <Pressable
          onPress={() => {
            setActionError(null);
            setPrompt({ mode: "save" });
          }}
          style={({ pressed }) => [styles.saveRow, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="bookmark-outline" size={16} color={theme.tint} />
          <ThemedText type="small" style={{ color: theme.tint }}>
            Save this search
          </ThemedText>
        </Pressable>
      ) : null}

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
      {results.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={results.error instanceof Error ? results.error.message : "Search failed."}
          />
        </View>
      ) : null}
      {saved.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={
              saved.error instanceof Error ? saved.error.message : "Couldn't load saved searches."
            }
          />
        </View>
      ) : null}

      {submitted ? (
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
            ) : (
              <EmptyState
                icon="search-outline"
                title="No matches"
                message={`Nothing found for "${submitted}".`}
              />
            )
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={searches}
          keyExtractor={(item) => item.id}
          renderItem={savedRow}
          ListHeaderComponent={
            searches.length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>
                Saved searches
              </ThemedText>
            ) : null
          }
          ListEmptyComponent={
            saved.isLoading ? (
              <Loading label="Loading saved searches…" />
            ) : (
              <EmptyState
                icon="search-outline"
                title="Search mail"
                message={
                  global
                    ? "Searches subject, body and people across every mailbox."
                    : "Searches subject, body and people in this mailbox. Run a search, then save it for one tap later."
                }
              />
            )
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        />
      )}

      <PromptDialog
        visible={prompt !== null}
        title={prompt?.mode === "rename" ? "Edit saved search" : "Save this search"}
        fields={fields}
        confirmLabel={prompt?.mode === "rename" ? "Save" : "Save search"}
        busy={createSaved.isPending || updateSaved.isPending}
        onSubmit={submit}
        onCancel={() => setPrompt(null)}
      />

      <ConfirmDialog
        visible={confirmDelete !== null}
        title="Delete this saved search?"
        message={confirmDelete ? `“${confirmDelete.name}” is removed from the list.` : undefined}
        confirmLabel="Delete"
        destructive
        busy={deleteSaved.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          if (!target) return;
          deleteSaved.mutate(target.id, {
            onSuccess: () => {
              setConfirmDelete(null);
              setNotice(`Deleted “${target.name}”.`);
            },
            onError: (err) => {
              setConfirmDelete(null);
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
  saveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  bannerWrap: {
    paddingHorizontal: Spacing.three,
  },
  sectionTitle: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  savedText: {
    flex: 1,
    gap: 2,
  },
  listContent: {
    flexGrow: 1,
  },
});
