/**
 * The message's attachment strip plus a detail card. Text-ish attachments
 * are fetched on demand through get_attachment (metadata always; decoded
 * text only, capped, never raw bytes).
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import type { AttachmentInfo, ScopedApi } from "@/lib/api";
import { formatFileSize } from "@/lib/format";
import { useAttachment } from "@/lib/queries";

export function AttachmentBar({
  api,
  mailboxId,
  attachments,
}: {
  api: ScopedApi;
  mailboxId: string;
  attachments: AttachmentInfo[];
}) {
  const theme = useTheme();
  const [open, setOpen] = useState<AttachmentInfo | null>(null);

  return (
    <View style={[styles.wrap, { borderTopColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {attachments.map((attachment) => (
          <Pressable
            key={attachment.id}
            onPress={() => setOpen(attachment)}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Ionicons name="attach" size={14} color={theme.textSecondary} />
            <ThemedText type="small" numberOfLines={1} style={styles.name}>
              {attachment.filename}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatFileSize(attachment.size)}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.backdrop}>
          {open ? (
            <AttachmentCard
              api={api}
              mailboxId={mailboxId}
              attachment={open}
              onClose={() => setOpen(null)}
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function AttachmentCard({
  api,
  mailboxId,
  attachment,
  onClose,
}: {
  api: ScopedApi;
  mailboxId: string;
  attachment: AttachmentInfo;
  onClose: () => void;
}) {
  const theme = useTheme();
  const query = useAttachment(api, mailboxId, attachment.id);

  return (
    <View style={[styles.card, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitle}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {attachment.filename}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {attachment.mimetype} · {formatFileSize(attachment.size)}
          </ThemedText>
        </View>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
          <Ionicons name="close" size={22} color={theme.text} />
        </Pressable>
      </View>
      {query.isLoading ? <ActivityIndicator style={styles.cardBody} /> : null}
      {query.error ? (
        <ThemedText type="small" style={[styles.cardBody, { color: theme.danger }]}>
          {query.error instanceof Error ? query.error.message : "Couldn't load this attachment."}
        </ThemedText>
      ) : null}
      {query.data?.content.kind === "text" ? (
        <ScrollView style={styles.cardBody} contentContainerStyle={styles.cardBodyContent}>
          <ThemedText type="code" selectable>
            {query.data.content.text}
            {query.data.content.truncated ? "\n\n[truncated]" : ""}
          </ThemedText>
        </ScrollView>
      ) : null}
      {query.data?.content.kind === "omitted" ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.cardBody}>
          {query.data.content.reason}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 240,
  },
  name: {
    flexShrink: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "80%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    flex: 1,
    gap: 2,
  },
  cardBody: {
    flexGrow: 0,
  },
  cardBodyContent: {
    paddingVertical: 2,
  },
});
