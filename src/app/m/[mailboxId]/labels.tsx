import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { PromptDialog, type PromptField } from "@/components/prompt-dialog";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { Label } from "@/lib/api";
import { useCreateLabel, useDeleteLabel, useLabels, useUpdateLabel } from "@/lib/queries";
import { useSession } from "@/lib/session";

/** Manage the mailbox's labels: create, rename/recolor and delete. */
export default function LabelsScreen() {
  const { mailboxId } = useLocalSearchParams<{ mailboxId: string }>();
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const mailbox = mailboxId ?? "";
  const query = useLabels(api, mailbox);
  const createLabel = useCreateLabel(api, mailbox);
  const updateLabel = useUpdateLabel(api, mailbox);
  const deleteLabel = useDeleteLabel(api, mailbox);

  const [prompt, setPrompt] = useState<
    { mode: "create" } | { mode: "edit"; label: Label } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<Label | null>(null);
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

  const fields: PromptField[] =
    prompt?.mode === "edit"
      ? [
          { key: "name", label: "Name", initial: prompt.label.name, autoFocus: true },
          {
            key: "color",
            label: "Color (hex, optional)",
            initial: prompt.label.color ?? "",
            placeholder: "#f59e0b",
          },
        ]
      : [
          { key: "name", label: "Name", autoFocus: true, placeholder: "Urgent" },
          { key: "color", label: "Color (hex, optional)", placeholder: "#f59e0b" },
        ];

  const submit = (values: Record<string, string>) => {
    const name = (values.name ?? "").trim();
    const color = (values.color ?? "").trim();
    if (!name) {
      fail(new Error("A label needs a name."));
      return;
    }
    setError(null);
    if (prompt?.mode === "edit") {
      const target = prompt.label;
      updateLabel.mutate(
        { label: target.name, name, color },
        {
          onSuccess: () => {
            setPrompt(null);
            setNotice(`Updated “${name}”.`);
          },
          onError: fail,
        },
      );
    } else {
      const input: { name: string; color?: string } = { name };
      if (color) input.color = color;
      createLabel.mutate(input, {
        onSuccess: () => {
          setPrompt(null);
          setNotice(`Created “${name}”.`);
        },
        onError: fail,
      });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "Labels",
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderIconButton
                name="add"
                label="New label"
                onPress={() => setPrompt({ mode: "create" })}
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
      {error ? (
        <View style={styles.bannerWrap}>
          <Banner message={error} />
        </View>
      ) : null}
      {query.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={query.error instanceof Error ? query.error.message : "Couldn't load labels."}
          />
        </View>
      ) : null}
      <FlatList
        data={query.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setPrompt({ mode: "edit", label: item })}
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : "transparent",
              },
            ]}>
            <View style={[styles.dot, { backgroundColor: item.color || theme.tint }]} />
            <ThemedText type="default" style={styles.name}>
              {item.name}
            </ThemedText>
            <Pressable
              onPress={() => setConfirmDelete(item)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.name}`}>
              <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <Loading label="Loading labels…" />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title="No labels"
              message="Create one with the + button, then tag messages from the message view."
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <PromptDialog
        visible={prompt !== null}
        title={prompt?.mode === "edit" ? "Edit label" : "New label"}
        fields={fields}
        confirmLabel={prompt?.mode === "edit" ? "Save" : "Create"}
        busy={createLabel.isPending || updateLabel.isPending}
        onSubmit={submit}
        onCancel={() => setPrompt(null)}
      />

      <ConfirmDialog
        visible={confirmDelete !== null}
        title="Delete this label?"
        message={
          confirmDelete
            ? `“${confirmDelete.name}” is removed from every message that carries it. The messages themselves are not touched.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        busy={deleteLabel.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          if (!target) return;
          deleteLabel.mutate(target.name, {
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
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingRight: Spacing.two,
  },
  bannerWrap: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  name: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
});
