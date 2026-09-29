import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import type { EmailSummary } from "@/lib/api";
import { stripHtmlToText } from "@/lib/email-html";
import { formatEmailDate, senderInitial, senderName, truncate } from "@/lib/format";

export function EmailRow({
  email,
  onPress,
  showFolder,
}: {
  email: EmailSummary;
  onPress: () => void;
  showFolder?: boolean;
}) {
  const theme = useTheme();
  const preview = truncate(stripHtmlToText(email.snippet ?? ""), 140);
  const unread = email.read === false;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : "transparent" }]}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="smallBold">{senderInitial(email.sender)}</ThemedText>
      </View>
      <View style={styles.middle}>
        <View style={styles.line}>
          <ThemedText
            type="small"
            numberOfLines={1}
            style={[styles.sender, unread && styles.unread, { flex: 1 }]}>
            {senderName(email.sender)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatEmailDate(email.date)}
          </ThemedText>
        </View>
        <ThemedText type="small" numberOfLines={1} style={unread ? styles.unread : undefined}>
          {email.subject?.trim() || "(no subject)"}
        </ThemedText>
        {preview.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {preview}
          </ThemedText>
        ) : null}
        {showFolder && email.folder_name ? (
          <ThemedText type="small" style={[styles.folder, { color: theme.tint }]}>
            {email.folder_name}
            {email.mailboxId ? ` · ${email.mailboxId}` : ""}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.flags}>
        {email.starred ? <Ionicons name="star" size={14} color="#E8A33D" /> : null}
        {unread ? <View style={[styles.dot, { backgroundColor: theme.tint }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sender: {
    flexShrink: 1,
  },
  unread: {
    fontWeight: 700,
  },
  folder: {
    marginTop: 2,
  },
  flags: {
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
