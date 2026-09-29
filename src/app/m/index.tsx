import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Stack, useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, View } from "react-native";

import { Banner } from "@/components/banner";
import { EmptyState } from "@/components/empty-state";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useMailboxes } from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function MailboxesScreen() {
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const mailboxes = useMailboxes(api);

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  if (session.kind === "mailbox") {
    return (
      <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: session.mailboxId ?? "" } }} />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "Mailboxes",
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderIconButton name="search" label="Search" onPress={() => router.push("/search")} />
              <HeaderIconButton name="settings-outline" label="Settings" onPress={() => router.push("/settings")} />
            </View>
          ),
        }}
      />
      {mailboxes.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={mailboxes.error instanceof Error ? mailboxes.error.message : "Couldn't load mailboxes."}
          />
        </View>
      ) : null}
      <FlatList
        data={mailboxes.data ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: "/m/[mailboxId]", params: { mailboxId: item.id } })}
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : "transparent",
              },
            ]}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">{item.email.charAt(0).toUpperCase()}</ThemedText>
            </View>
            <View style={styles.middle}>
              <ThemedText type="smallBold">{item.email}</ThemedText>
              {item.id !== item.email ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {item.id}
                </ThemedText>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </Pressable>
        )}
        refreshing={mailboxes.isRefetching}
        onRefresh={() => void mailboxes.refetch()}
        ListEmptyComponent={
          mailboxes.isLoading ? (
            <Loading label="Loading mailboxes…" />
          ) : (
            <EmptyState
              icon="mail-outline"
              title="No mailboxes"
              message="The server reports no mailboxes for this deployment."
            />
          )
        }
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
  bannerWrap: {
    padding: Spacing.three,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  listContent: {
    flexGrow: 1,
  },
});
