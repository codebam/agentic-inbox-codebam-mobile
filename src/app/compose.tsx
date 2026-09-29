import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner } from "@/components/banner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useCreateDraft, useDraftReply, useSendEmail, useSendReply, useUpdateDraft } from "@/lib/queries";
import { useSession } from "@/lib/session";

type ComposeMode = "new" | "reply" | "draft";

export default function ComposeScreen() {
  const params = useLocalSearchParams<{
    mailboxId: string;
    mode?: string;
    emailId?: string;
    draftId?: string;
    to?: string;
    subject?: string;
    body?: string;
  }>();
  const mailboxId = params.mailboxId ?? "";
  const mode: ComposeMode = params.mode === "reply" ? "reply" : params.mode === "draft" ? "draft" : "new";

  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [to, setTo] = useState(params.to ?? "");
  const [subject, setSubject] = useState(params.subject ?? "");
  const [body, setBody] = useState(params.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sendReply = useSendReply(api, mailboxId);
  const sendEmail = useSendEmail(api, mailboxId);
  const draftReply = useDraftReply(api, mailboxId);
  const createDraft = useCreateDraft(api, mailboxId);
  const updateDraft = useUpdateDraft(api, mailboxId);

  const sending = sendReply.isPending || sendEmail.isPending;
  const saving = draftReply.isPending || createDraft.isPending || updateDraft.isPending;
  const busy = sending || saving;

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;

  const validate = (): string | null => {
    const recipient = to.trim();
    if (!recipient || !recipient.includes("@")) return "Add a recipient email address first.";
    if (!body.trim()) return "Write a message first.";
    return null;
  };

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong.");

  const done = (message: string, delay: number) => {
    setSuccess(message);
    setTimeout(() => router.back(), delay);
  };

  const performSend = () => {
    setError(null);
    if (mode === "reply" && params.emailId) {
      sendReply.mutate(
        { originalEmailId: params.emailId, to: to.trim(), subject: subject.trim(), body },
        {
          onSuccess: (result) => done(result.message ?? `Reply sent to ${to.trim()}.`, 1200),
          onError: fail,
        },
      );
    } else {
      sendEmail.mutate(
        { to: to.trim(), subject: subject.trim(), body },
        {
          onSuccess: (result) => done(result.message ?? `Message sent to ${to.trim()}.`, 1200),
          onError: fail,
        },
      );
    }
  };

  const requestSend = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setConfirmOpen(true);
  };

  const performSave = () => {
    setError(null);
    const saved = (message: string) => done(message, 1000);
    if (mode === "reply" && params.emailId) {
      draftReply.mutate(
        { originalEmailId: params.emailId, to: to.trim(), subject: subject.trim(), body },
        { onSuccess: () => saved("Draft saved to Drafts."), onError: fail },
      );
    } else if (mode === "draft" && params.draftId) {
      updateDraft.mutate(
        { draftId: params.draftId, to: to.trim(), subject: subject.trim(), body },
        { onSuccess: () => saved("Draft updated."), onError: fail },
      );
    } else {
      createDraft.mutate(
        { to: to.trim(), subject: subject.trim(), body },
        { onSuccess: () => saved("Draft saved to Drafts."), onError: fail },
      );
    }
  };

  const title = mode === "reply" ? "Reply" : mode === "draft" ? "Edit draft" : "New message";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          {success ? <Banner tone="success" message={success} /> : null}
          {error ? <Banner message={error} /> : null}

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              To
            </ThemedText>
            <View style={[styles.inputBox, { backgroundColor: theme.backgroundElement }]}>
              <TextInput
                value={to}
                onChangeText={setTo}
                placeholder="name@example.com"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={[styles.input, { color: theme.text }]}
                accessibilityLabel="Recipient"
              />
            </View>
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Subject
            </ThemedText>
            <View style={[styles.inputBox, { backgroundColor: theme.backgroundElement }]}>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder="(no subject)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
                accessibilityLabel="Subject"
              />
            </View>
          </View>

          <View style={styles.field}>
            <ThemedText type="small" themeColor="textSecondary">
              Message
            </ThemedText>
            <View style={[styles.inputBox, { backgroundColor: theme.backgroundElement }]}>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Write your message…"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.bodyInput, { color: theme.text }]}
                accessibilityLabel="Message body"
              />
            </View>
          </View>
        </ScrollView>

        <View style={[styles.actions, { borderTopColor: theme.border, paddingBottom: Spacing.two + insets.bottom }]}>
          {mode === "draft" ? (
            <Pressable
              onPress={performSave}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.tint, opacity: busy ? 0.5 : pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.primaryLabel}>
                {updateDraft.isPending ? "Updating…" : "Update draft"}
              </ThemedText>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={requestSend}
                disabled={busy}
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.tint, opacity: busy ? 0.5 : pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="smallBold" style={styles.primaryLabel}>
                  {sending ? "Sending…" : "Send"}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={performSave}
                disabled={busy}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: theme.backgroundElement,
                    opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}>
                <ThemedText type="smallBold">
                  {saving ? "Saving…" : "Save draft"}
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmOpen}
        title={mode === "reply" ? "Send reply?" : "Send message?"}
        message={`To: ${to.trim()}`}
        confirmLabel="Send"
        busy={sending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          performSend();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  form: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  inputBox: {
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
  },
  input: {
    fontSize: 15,
    paddingVertical: 12,
  },
  bodyInput: {
    minHeight: 200,
    maxHeight: 420,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: {
    color: "#ffffff",
  },
});
