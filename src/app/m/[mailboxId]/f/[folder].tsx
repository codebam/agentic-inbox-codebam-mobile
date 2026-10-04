import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ComponentProps } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmailRow } from "@/components/email-row";
import { EmptyState } from "@/components/empty-state";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { BatchAction } from "@/lib/api";
import { folderDisplayName } from "@/lib/format";
import { moveTargets } from "@/lib/manage";
import { useEmails, useEmptyTrash, useManageBatch, useRestoreBatch } from "@/lib/queries";
import { useSession } from "@/lib/session";

type IconName = ComponentProps<typeof Ionicons>["name"];

const EMPTY_COPY: Record<string, string> = {
  inbox: "Nothing new here.",
  sent: "Nothing sent yet.",
  draft: "No drafts.",
  archive: "Nothing archived.",
  snoozed: "Nothing snoozed.",
  spam: "No spam. Nice.",
  trash: "Trash is empty.",
};

export default function FolderScreen() {
  const { mailboxId, folder } = useLocalSearchParams<{ mailboxId: string; folder: string }>();
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const query = useEmails(api, mailboxId ?? "", folder ?? "inbox");
  const batch = useManageBatch(api, mailboxId ?? "");
  const restoreBatch = useRestoreBatch(api, mailboxId ?? "");
  const emptyTrash = useEmptyTrash(api, mailboxId ?? "");

  // null = normal browsing; a Set (possibly empty) = selection mode.
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ title: string; actions: SheetAction[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailboxId;
  if (!mailboxId || (session.kind === "mailbox" && mailboxId !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  const emails = query.data?.pages.flat() ?? [];
  const folderName = folderDisplayName(folder ?? "inbox");
  const inTrash = (folder ?? "").toLowerCase() === "trash";
  const selecting = selection !== null;
  const selectedIds = selection ? [...selection] : [];
  const count = selectedIds.length;

  const toggle = (id: string) => {
    setSelection((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelection(null);
    setProgress(null);
  };

  /** Run one action over the selection, sequentially, with progress. */
  const run = (label: string, action: BatchAction) => {
    if (count === 0) return;
    setActionError(null);
    setNotice(null);
    const ids = selectedIds;
    batch.mutate(
      {
        ids,
        action,
        onProgress: (done, total) => setProgress(`${label} ${done} of ${total}`),
      },
      {
        onSuccess: (result) => {
          setProgress(null);
          setSelection(null);
          setNotice(`${label}: ${result.done} of ${ids.length} messages.`);
        },
        onError: (error) => {
          setProgress(null);
          setActionError(error instanceof Error ? error.message : "The batch stopped.");
        },
      },
    );
  };

  /** Restore the selection to the Inbox, sequentially, with progress. */
  const runRestore = () => {
    if (count === 0) return;
    setActionError(null);
    setNotice(null);
    const ids = selectedIds;
    restoreBatch.mutate(
      {
        ids,
        onProgress: (done, total) => setProgress(`Restoring ${done} of ${total}`),
      },
      {
        onSuccess: (result) => {
          setProgress(null);
          setSelection(null);
          setNotice(`Restored: ${result.done} of ${ids.length} messages.`);
        },
        onError: (error) => {
          setProgress(null);
          setActionError(error instanceof Error ? error.message : "The restore stopped.");
        },
      },
    );
  };

  const openMove = () => {
    setSheet({
      title: `Move ${count === 1 ? "1 message" : `${count} messages`} to`,
      actions: moveTargets(folder ?? "inbox").map((target) => ({
        label: target.name,
        onPress: () => {
          setSheet(null);
          run(`Moved to ${target.name}`, { kind: "move", folderId: target.id });
        },
      })),
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: selecting ? `${count} selected` : folderName,
          headerRight: () => (
            <View style={styles.headerButtons}>
              {selecting ? (
                <>
                  <HeaderIconButton
                    name="checkmark-done-outline"
                    label="Select all"
                    onPress={() => setSelection(new Set(emails.map((email) => email.id)))}
                  />
                  <HeaderIconButton name="close" label="Cancel selection" onPress={exitSelection} />
                </>
              ) : (
                <>
                  {inTrash ? (
                    <HeaderIconButton
                      name="trash-bin-outline"
                      label="Empty trash"
                      onPress={() => setConfirmEmpty(true)}
                    />
                  ) : null}
                  <HeaderIconButton
                    name="checkmark-circle-outline"
                    label="Select"
                    onPress={() => setSelection(new Set())}
                  />
                  <HeaderIconButton
                    name="create-outline"
                    label="New message"
                    onPress={() => router.push({ pathname: "/compose", params: { mailboxId, mode: "new" } })}
                  />
                  <HeaderIconButton
                    name="search"
                    label="Search"
                    onPress={() => router.push({ pathname: "/search", params: { mailboxId } })}
                  />
                </>
              )}
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
      {progress ? (
        <View style={styles.bannerWrap}>
          <Banner message={progress} tone="info" />
        </View>
      ) : null}
      {query.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={query.error instanceof Error ? query.error.message : `Couldn't load ${folderName}.`}
          />
        </View>
      ) : null}
      <FlatList
        data={emails}
        keyExtractor={(item) => item.id}
        extraData={selection}
        renderItem={({ item }) => (
          <EmailRow
            email={item}
            selectable={selecting}
            selected={selection?.has(item.id) ?? false}
            onPress={() => {
              if (selecting) {
                toggle(item.id);
                return;
              }
              router.push({
                pathname: "/m/[mailboxId]/e/[emailId]",
                params: { mailboxId, emailId: item.id },
              });
            }}
            onLongPress={() => (selecting ? toggle(item.id) : setSelection(new Set([item.id])))}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.border }]} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={() => void query.refetch()}
            tintColor={theme.textSecondary}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListFooterComponent={
          query.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : null
        }
        ListEmptyComponent={
          query.isLoading ? (
            <Loading label={`Loading ${folderName}…`} />
          ) : query.error ? null : (
            <EmptyState
              icon="mail-open-outline"
              title={folderName}
              message={EMPTY_COPY[(folder ?? "inbox").toLowerCase()] ?? "No messages."}
            />
          )
        }
        contentContainerStyle={styles.listContent}
      />

      {selecting ? (
        <View
          style={[
            styles.selectBar,
            { borderTopColor: theme.border, paddingBottom: Spacing.two + insets.bottom },
          ]}>
          <SelectButton
            icon="mail-open-outline"
            label="Read"
            disabled={count === 0 || batch.isPending}
            onPress={() => run("Marked read", { kind: "read", read: true })}
          />
          <SelectButton
            icon="mail-unread-outline"
            label="Unread"
            disabled={count === 0 || batch.isPending}
            onPress={() => run("Marked unread", { kind: "read", read: false })}
          />
          <SelectButton
            icon="star-outline"
            label="Star"
            disabled={count === 0 || batch.isPending}
            onPress={() => run("Starred", { kind: "star", starred: true })}
          />
          <SelectButton
            icon="file-tray-full-outline"
            label="Move"
            disabled={count === 0 || batch.isPending}
            onPress={openMove}
          />
          {inTrash ? (
            <SelectButton
              icon="arrow-undo-outline"
              label="Restore"
              disabled={count === 0 || batch.isPending || restoreBatch.isPending}
              onPress={runRestore}
            />
          ) : null}
          <SelectButton
            icon="trash-outline"
            label="Delete"
            disabled={count === 0 || batch.isPending}
            onPress={() => setConfirmDelete(true)}
          />
        </View>
      ) : null}

      <ActionSheet
        visible={sheet !== null}
        title={sheet?.title}
        actions={sheet?.actions ?? []}
        onCancel={() => setSheet(null)}
      />

      <ConfirmDialog
        visible={confirmDelete}
        title={inTrash ? "Delete permanently?" : "Move to Trash?"}
        message={
          inTrash
            ? `This permanently deletes ${count === 1 ? "1 message" : `${count} messages`}.`
            : `Moves ${count === 1 ? "1 message" : `${count} messages`} to Trash.`
        }
        confirmLabel={inTrash ? "Delete" : "Trash"}
        destructive
        busy={batch.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          run(inTrash ? "Deleted" : "Moved to Trash", { kind: "delete", permanent: inTrash });
        }}
      />

      <ConfirmDialog
        visible={confirmEmpty}
        title="Empty the Trash?"
        message="This permanently deletes every message in Trash. This cannot be undone."
        confirmLabel="Empty trash"
        destructive
        busy={emptyTrash.isPending}
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={() => {
          setConfirmEmpty(false);
          emptyTrash.mutate(undefined, {
            onSuccess: (result) => {
              setNotice(
                result.purged === 1
                  ? "Emptied 1 message from Trash."
                  : `Emptied ${result.purged} messages from Trash.`,
              );
            },
            onError: (error) =>
              setActionError(error instanceof Error ? error.message : "Couldn't empty the Trash."),
          });
        }}
      />
    </View>
  );
}

function SelectButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const color = disabled ? theme.textSecondary : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectButton,
        {
          backgroundColor: pressed && !disabled ? theme.backgroundSelected : "transparent",
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      <Ionicons name={icon} size={18} color={color} />
      <ThemedText type="small" style={[styles.selectLabel, { color }]}>
        {label}
      </ThemedText>
    </Pressable>
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
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
  footer: {
    padding: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
  },
  selectBar: {
    flexDirection: "row",
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    paddingTop: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 10,
    paddingVertical: Spacing.two,
  },
  selectLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
});
