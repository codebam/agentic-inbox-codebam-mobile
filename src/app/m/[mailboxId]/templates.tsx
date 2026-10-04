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
import type { TemplateRow } from "@/lib/api";
import { truncate } from "@/lib/format";
import { useCreateTemplate, useDeleteTemplate, useTemplates, useUpdateTemplate } from "@/lib/queries";
import { useSession } from "@/lib/session";

/** Manage the mailbox's templates: create, edit and delete reusable snippets. */
export default function TemplatesScreen() {
  const { mailboxId } = useLocalSearchParams<{ mailboxId: string }>();
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const mailbox = mailboxId ?? "";
  const query = useTemplates(api, mailbox);
  const createTemplate = useCreateTemplate(api, mailbox);
  const updateTemplate = useUpdateTemplate(api, mailbox);
  const deleteTemplate = useDeleteTemplate(api, mailbox);

  const [prompt, setPrompt] = useState<
    { mode: "create" } | { mode: "edit"; template: TemplateRow } | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<TemplateRow | null>(null);
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
          { key: "name", label: "Name", initial: prompt.template.name, autoFocus: true },
          { key: "subject", label: "Subject (optional)", initial: prompt.template.subject ?? "" },
          { key: "body", label: "Body", initial: prompt.template.body ?? "", multiline: true },
        ]
      : [
          { key: "name", label: "Name", autoFocus: true, placeholder: "Welcome reply" },
          { key: "subject", label: "Subject (optional)", placeholder: "Hello there" },
          { key: "body", label: "Body", placeholder: "Write the snippet…", multiline: true },
        ];

  const submit = (values: Record<string, string>) => {
    const name = (values.name ?? "").trim();
    const subject = (values.subject ?? "").trim();
    const body = (values.body ?? "").trim();
    if (!name) {
      fail(new Error("A template needs a name."));
      return;
    }
    if (!body) {
      fail(new Error("A template needs a body."));
      return;
    }
    setError(null);
    if (prompt?.mode === "edit") {
      const target = prompt.template;
      updateTemplate.mutate(
        { templateId: target.id, name, subject, body },
        {
          onSuccess: () => {
            setPrompt(null);
            setNotice(`Updated “${name}”.`);
          },
          onError: fail,
        },
      );
    } else {
      const input: { name: string; subject?: string; body: string } = { name, body };
      if (subject) input.subject = subject;
      createTemplate.mutate(input, {
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
          title: "Templates",
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderIconButton
                name="add"
                label="New template"
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
            message={
              query.error instanceof Error ? query.error.message : "Couldn't load templates."
            }
          />
        </View>
      ) : null}
      <FlatList
        data={query.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setPrompt({ mode: "edit", template: item })}
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : "transparent",
              },
            ]}>
            <View style={styles.rowText}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {item.name}
              </ThemedText>
              {item.subject ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {item.subject}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {truncate((item.body ?? "").replace(/\s+/g, " ").trim(), 120)}
              </ThemedText>
            </View>
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
            <Loading label="Loading templates…" />
          ) : (
            <EmptyState
              icon="document-text-outline"
              title="No templates"
              message="Create one with the + button, then insert it from the composer."
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />

      <PromptDialog
        visible={prompt !== null}
        title={prompt?.mode === "edit" ? "Edit template" : "New template"}
        fields={fields}
        confirmLabel={prompt?.mode === "edit" ? "Save" : "Create"}
        busy={createTemplate.isPending || updateTemplate.isPending}
        onSubmit={submit}
        onCancel={() => setPrompt(null)}
      />

      <ConfirmDialog
        visible={confirmDelete !== null}
        title="Delete this template?"
        message={confirmDelete ? `“${confirmDelete.name}” is removed for good.` : undefined}
        confirmLabel="Delete"
        destructive
        busy={deleteTemplate.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          if (!target) return;
          deleteTemplate.mutate(target.id, {
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
  rowText: {
    flex: 1,
    gap: 2,
  },
  listContent: {
    flexGrow: 1,
  },
});
