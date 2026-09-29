import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { SYSTEM_FOLDERS } from "@/lib/format";
import { useSession } from "@/lib/session";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const FOLDER_ICONS: Record<string, IconName> = {
  inbox: "mail-outline",
  sent: "paper-plane-outline",
  draft: "document-text-outline",
  archive: "archive-outline",
  snoozed: "time-outline",
  spam: "ban-outline",
  trash: "trash-outline",
};

export default function FoldersScreen() {
  const { mailboxId } = useLocalSearchParams<{ mailboxId: string }>();
  const { session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();

  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailboxId;
  if (!mailboxId || (session.kind === "mailbox" && mailboxId !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: mailboxId,
          headerRight: () => (
            <View style={styles.headerButtons}>
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
            </View>
          ),
        }}
      />
      <FlatList
        data={SYSTEM_FOLDERS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/m/[mailboxId]/f/[folder]",
                params: { mailboxId, folder: item.id },
              })
            }
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : "transparent",
              },
            ]}>
            <Ionicons name={FOLDER_ICONS[item.id] ?? "folder-outline"} size={22} color={theme.tint} />
            <ThemedText type="default" style={styles.name}>
              {item.name}
            </ThemedText>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>
        )}
        ListHeaderComponent={
          session.kind === "app" ? (
            <View style={styles.hint}>
              <ThemedText type="small" themeColor="textSecondary">
                Global key: this app can open every mailbox. Switch mailboxes from the Mailboxes
                screen.
              </ThemedText>
            </View>
          ) : null
        }
        ListEmptyComponent={<EmptyState icon="folder-outline" title="No folders" />}
        contentContainerStyle={styles.listContent}
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: {
    flex: 1,
  },
  hint: {
    padding: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
  },
});
