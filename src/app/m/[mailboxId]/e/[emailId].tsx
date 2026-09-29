import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import { AttachmentBar } from "@/components/attachment-bar";
import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmailBody } from "@/components/email-body";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, type EmailFull } from "@/lib/api";
import { buildEmailDocument, plainTextToHtml } from "@/lib/email-html";
import { folderDisplayName, formatFullDate, replySubject, senderAddress, senderName, truncate } from "@/lib/format";
import { moveTargets, oneClickUnsubscribeTarget, snoozePresets } from "@/lib/manage";
import {
  useDeleteEmail,
  useDiscardDraft,
  useEmail,
  useMarkEmailRead,
  useMoveEmail,
  useSetSenderPolicy,
  useSnoozeEmail,
  useStarEmail,
  useUnsubscribeEmail,
  useUnsnoozeEmail,
} from "@/lib/queries";
import { useSession } from "@/lib/session";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

// Surface a missing manage scope at most once per app run: auto mark-read
// fails quietly for a read-only key, but a banner on every unread message
// would be noise.
let warnedMissingManageScope = false;

export default function EmailScreen() {
  const { mailboxId, emailId } = useLocalSearchParams<{ mailboxId: string; emailId: string }>();
  const mailbox = mailboxId ?? "";
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = colorScheme === "dark" ? "dark" : "light";

  const emailQuery = useEmail(api, mailbox, emailId ?? "");
  const discardDraft = useDiscardDraft(api, mailbox);
  const markRead = useMarkEmailRead(api, mailbox);
  const star = useStarEmail(api, mailbox);
  const move = useMoveEmail(api, mailbox);
  const remove = useDeleteEmail(api, mailbox);
  const snooze = useSnoozeEmail(api, mailbox);
  const unsnooze = useUnsnoozeEmail(api, mailbox);
  const senderPolicy = useSetSenderPolicy(api, mailbox);
  const unsubscribe = useUnsubscribeEmail(api, mailbox);

  const [plainText, setPlainText] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false);
  const [sheet, setSheet] = useState<{ title: string; actions: SheetAction[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const email = emailQuery.data;

  // Opening a message marks it read, once per message and never for a draft.
  // It is a background convenience: an error here stays quiet and leaves the
  // explicit Read/Unread toggle to report it.
  const autoReadFor = useRef<string | null>(null);
  useEffect(() => {
    if (!email || email.read) return;
    if (email.folder_id === "draft") return;
    if (autoReadFor.current === email.id) return;
    autoReadFor.current = email.id;
    markRead.mutate(
      { emailId: email.id, read: true },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.status === 403 && !warnedMissingManageScope) {
            warnedMissingManageScope = true;
            setActionError(error.message);
          }
        },
      },
    );
  }, [email, markRead]);

  const bodyHtml = useMemo(() => {
    if (!email) return "";
    const html = email.body && email.body.trim() ? email.body : plainTextToHtml(email.body_text ?? "");
    return buildEmailDocument({
      subject: email.subject,
      sender: email.sender,
      recipient: email.recipient,
      cc: email.cc,
      date: formatFullDate(email.date),
      folderName: email.folder_name ?? folderDisplayName(email.folder_id ?? ""),
      bodyHtml: html,
      scheme,
    });
  }, [email, scheme]);

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailbox;
  if (!mailbox || (session.kind === "mailbox" && mailbox !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  const reply = (message: EmailFull) => {
    router.push({
      pathname: "/compose",
      params: {
        mailboxId: mailbox,
        mode: "reply",
        emailId: message.id,
        to: senderAddress(message.reply_to || message.sender),
        subject: replySubject(message.subject),
      },
    });
  };

  const editDraft = (message: EmailFull) => {
    router.push({
      pathname: "/compose",
      params: {
        mailboxId: mailbox,
        mode: "draft",
        draftId: message.id,
        to: message.recipient ?? "",
        subject: message.subject ?? "",
        body: message.body_text ?? "",
      },
    });
  };

  const fail = (error: unknown) => {
    setNotice(null);
    setActionError(error instanceof Error ? error.message : "The action failed.");
  };

  const goBack = () => router.back();

  const toggleStar = () => {
    if (!email) return;
    setActionError(null);
    star.mutate({ emailId: email.id, starred: !email.starred }, { onError: fail });
  };

  const toggleRead = () => {
    if (!email) return;
    setActionError(null);
    markRead.mutate({ emailId: email.id, read: !email.read }, { onError: fail });
  };

  const wakeNow = () => {
    if (!email) return;
    setActionError(null);
    unsnooze.mutate(email.id, {
      onSuccess: () => setNotice("Woke the message; it is back in its folder."),
      onError: fail,
    });
  };

  const openMove = () => {
    if (!email) return;
    setActionError(null);
    setSheet({
      title: "Move to",
      actions: moveTargets(email.folder_id ?? "inbox").map((folder) => ({
        label: folder.name,
        onPress: () => {
          setSheet(null);
          move.mutate({ emailId: email.id, folderId: folder.id }, { onSuccess: goBack, onError: fail });
        },
      })),
    });
  };

  const openSnooze = () => {
    if (!email) return;
    setActionError(null);
    setSheet({
      title: "Snooze until",
      actions: snoozePresets(new Date()).map((preset) => ({
        label: preset.label,
        onPress: () => {
          setSheet(null);
          snooze.mutate({ emailId: email.id, until: preset.until }, { onSuccess: goBack, onError: fail });
        },
      })),
    });
  };

  const openMore = () => {
    if (!email) return;
    setActionError(null);
    const actions: SheetAction[] = [];
    if (oneClickUnsubscribeTarget(email)) {
      actions.push({
        label: "Unsubscribe from this sender",
        onPress: () => {
          setSheet(null);
          setConfirmUnsubscribe(true);
        },
      });
    }
    actions.push({
      label: "Block sender (moves the message to Spam)",
      destructive: true,
      onPress: () => {
        setSheet(null);
        senderPolicy.mutate({ emailId: email.id, policy: "block" }, { onSuccess: goBack, onError: fail });
      },
    });
    actions.push({
      label: "Allow sender (moves the message to Inbox)",
      onPress: () => {
        setSheet(null);
        senderPolicy.mutate({ emailId: email.id, policy: "allow" }, { onSuccess: goBack, onError: fail });
      },
    });
    setSheet({ title: "More actions", actions });
  };

  const isDraft = email?.folder_id === "draft";
  const inTrash = email?.folder_id === "trash";
  const busy =
    markRead.isPending ||
    star.isPending ||
    move.isPending ||
    remove.isPending ||
    snooze.isPending ||
    unsnooze.isPending ||
    senderPolicy.isPending ||
    unsubscribe.isPending;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: truncate(email?.subject?.trim() || "Message", 42),
          headerRight: () => (
            <HeaderIconButton
              name={plainText ? "reader-outline" : "code-slash"}
              label={plainText ? "Show formatted message" : "Show plain text"}
              onPress={() => setPlainText((value) => !value)}
            />
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

      {emailQuery.isLoading ? <Loading label="Loading message…" /> : null}

      {emailQuery.error ? (
        <View style={styles.center}>
          <Banner
            message={emailQuery.error instanceof Error ? emailQuery.error.message : "Couldn't load this message."}
          />
          <Pressable onPress={() => void emailQuery.refetch()} style={styles.retry}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Retry
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {email ? (
        <>
          {!isDraft ? (
            <View style={[styles.manageBar, { borderBottomColor: theme.border }]}>
              <ManageButton
                icon={email.starred ? "star" : "star-outline"}
                label={email.starred ? "Unstar" : "Star"}
                active={email.starred}
                onPress={toggleStar}
              />
              <ManageButton
                icon={email.read ? "mail-unread-outline" : "mail-open-outline"}
                label={email.read ? "Unread" : "Read"}
                onPress={toggleRead}
              />
              <ManageButton icon="file-tray-full-outline" label="Move" onPress={openMove} />
              {inTrash ? null : email.folder_id === "snoozed" ? (
                <ManageButton icon="sunny-outline" label="Wake" onPress={wakeNow} />
              ) : (
                <ManageButton icon="time-outline" label="Snooze" onPress={openSnooze} />
              )}
              <ManageButton
                icon="trash-outline"
                label="Delete"
                onPress={() => {
                  setActionError(null);
                  setConfirmDelete(true);
                }}
              />
              <ManageButton icon="ellipsis-horizontal" label="More" onPress={openMore} />
            </View>
          ) : null}

          {plainText ? (
            <ScrollView style={styles.bodyWrap} contentContainerStyle={styles.plainContent}>
              <ThemedText type="smallBold">{email.subject?.trim() || "(no subject)"}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {senderName(email.sender)} · {formatFullDate(email.date)}
              </ThemedText>
              <ThemedText style={styles.plainBody} selectable>
                {email.body_text?.trim() || "(no content)"}
              </ThemedText>
            </ScrollView>
          ) : (
            <View style={styles.bodyWrap}>
              <EmailBody html={bodyHtml} />
            </View>
          )}

          {email.attachments && email.attachments.length > 0 ? (
            <AttachmentBar api={api} mailboxId={mailbox} attachments={email.attachments} />
          ) : null}

          <View style={[styles.actions, { borderTopColor: theme.border, paddingBottom: Spacing.two + insets.bottom }]}>
            {isDraft ? (
              <>
                <ActionButton icon="create-outline" label="Edit draft" onPress={() => editDraft(email)} />
                <ActionButton
                  icon="trash-outline"
                  label="Discard"
                  danger
                  onPress={() => setConfirmDiscard(true)}
                />
              </>
            ) : (
              <>
                <ActionButton icon="arrow-undo-outline" label="Reply" primary onPress={() => reply(email)} />
                {email.thread_id ? (
                  <ActionButton
                    icon="albums-outline"
                    label="Thread"
                    onPress={() =>
                      router.push({
                        pathname: "/m/[mailboxId]/t/[threadId]",
                        params: { mailboxId: mailbox, threadId: email.thread_id ?? "" },
                      })
                    }
                  />
                ) : null}
              </>
            )}
          </View>
        </>
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
        message={inTrash ? "This cannot be undone." : "You can restore it from Trash."}
        confirmLabel={inTrash ? "Delete" : "Trash"}
        destructive
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!email) return;
          remove.mutate(
            { emailId: email.id, permanent: inTrash },
            {
              onSuccess: () => {
                setConfirmDelete(false);
                goBack();
              },
              onError: (error) => {
                setConfirmDelete(false);
                fail(error);
              },
            },
          );
        }}
      />

      <ConfirmDialog
        visible={confirmUnsubscribe}
        title="Unsubscribe from this sender?"
        message="This asks the sender's own service to stop mailing this address, using the one-click link the message carries."
        confirmLabel="Unsubscribe"
        busy={busy}
        onCancel={() => setConfirmUnsubscribe(false)}
        onConfirm={() => {
          if (!email) return;
          unsubscribe.mutate(email.id, {
            onSuccess: () => {
              setConfirmUnsubscribe(false);
              setNotice("Unsubscribe request sent to the sender.");
            },
            onError: (error) => {
              setConfirmUnsubscribe(false);
              fail(error);
            },
          });
        }}
      />

      <ConfirmDialog
        visible={confirmDiscard}
        title="Discard draft?"
        message="This permanently removes the draft."
        confirmLabel="Discard"
        destructive
        busy={discardDraft.isPending}
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          discardDraft.mutate(emailId ?? "", {
            onSuccess: () => {
              setConfirmDiscard(false);
              router.back();
            },
            onError: (error) => {
              setConfirmDiscard(false);
              setActionError(error instanceof Error ? error.message : "Couldn't discard the draft.");
            },
          });
        }}
      />
    </View>
  );
}

function ManageButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = active ? theme.tint : theme.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.manageButton,
        { backgroundColor: pressed ? theme.backgroundSelected : "transparent" },
      ]}>
      <Ionicons name={icon} size={18} color={color} />
      <ThemedText type="small" style={[styles.manageLabel, { color }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  primary,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const theme = useTheme();
  const color = danger ? theme.danger : primary ? theme.tint : theme.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <Ionicons name={icon} size={20} color={color} />
      <ThemedText type="smallBold" style={{ color }}>
        {label}
      </ThemedText>
    </Pressable>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  retry: {
    padding: Spacing.two,
  },
  manageBar: {
    flexDirection: "row",
    gap: Spacing.half,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  manageButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 10,
    paddingVertical: Spacing.two,
  },
  manageLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  bodyWrap: {
    flex: 1,
  },
  plainContent: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  plainBody: {
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.two,
    borderRadius: 12,
    paddingVertical: 12,
  },
});
