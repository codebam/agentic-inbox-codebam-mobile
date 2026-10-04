import { Redirect, Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { Banner } from "@/components/banner";
import { EmailRow } from "@/components/email-row";
import { EmptyState } from "@/components/empty-state";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { EmailSummary } from "@/lib/api";
import { folderDisplayName, SYSTEM_FOLDERS } from "@/lib/format";
import { useAllEmails } from "@/lib/queries";
import { useSession } from "@/lib/session";

/** The merged view's tabs: All Mail, then every system folder but Snoozed. */
const FOLDER_TABS = [
  { id: "all", name: "All Mail" },
  ...SYSTEM_FOLDERS.filter((folder) => folder.id !== "snoozed"),
];

/** The row's account label, exactly as the web view derives it. */
function accountName(mailboxId: string | undefined): string {
  if (!mailboxId) return "unknown";
  return mailboxId.split("@")[0] || "unknown";
}

export default function AllAccountsScreen() {
  const { api, session, ready } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const [folder, setFolder] = useState("all");

  const listing = useAllEmails(api, folder === "all" ? null : folder);
  const emails = useMemo(
    () => (listing.data?.pages ?? []).flatMap((page) => page.emails),
    [listing.data],
  );

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  if (session.kind !== "app") {
    // The merged listing reaches every mailbox, so it needs a global key.
    return <Redirect href="/m" />;
  }

  const rowLabel = (email: EmailSummary): string => {
    const account = accountName(email.mailboxId);
    if (folder !== "all") return account;
    const where = email.folder_name ?? (email.folder_id ? folderDisplayName(email.folder_id) : null);
    return where ? `${where} · ${account}` : account;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "All Accounts",
          headerRight: () => (
            <HeaderIconButton name="search" label="Search" onPress={() => router.push("/search")} />
          ),
        }}
      />
      <View style={[styles.tabsWrap, { borderBottomColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}>
          {FOLDER_TABS.map((tab) => {
            const active = tab.id === folder;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setFolder(tab.id)}
                style={({ pressed }) => [
                  styles.tab,
                  {
                    backgroundColor: active
                      ? theme.tint
                      : pressed
                        ? theme.backgroundSelected
                        : "transparent",
                  },
                ]}>
                <ThemedText
                  type="small"
                  style={{ color: active ? theme.background : theme.text, fontWeight: 600 }}>
                  {tab.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {listing.error ? (
        <View style={styles.bannerWrap}>
          <Banner
            message={
              listing.error instanceof Error ? listing.error.message : "Couldn't load every mailbox."
            }
          />
        </View>
      ) : null}
      <FlatList
        data={emails}
        keyExtractor={(item) => `${item.mailboxId ?? "mailbox"}::${item.id}`}
        renderItem={({ item }) => (
          <EmailRow
            email={item}
            accountLabel={rowLabel(item)}
            onPress={() =>
              router.push({
                pathname: "/m/[mailboxId]/e/[emailId]",
                params: { mailboxId: item.mailboxId ?? "", emailId: item.id },
              })
            }
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={listing.isRefetching && !listing.isFetchingNextPage}
            onRefresh={() => void listing.refetch()}
            tintColor={theme.textSecondary}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (listing.hasNextPage && !listing.isFetchingNextPage) void listing.fetchNextPage();
        }}
        ListFooterComponent={listing.isFetchingNextPage ? <ActivityIndicator style={styles.footer} /> : null}
        ListEmptyComponent={
          listing.isLoading ? (
            <Loading label="Loading every mailbox…" />
          ) : listing.error ? null : (
            <EmptyState
              icon="albums-outline"
              title="All Accounts"
              message="No messages across every mailbox for this folder."
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
  tabsWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  tab: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  bannerWrap: {
    padding: Spacing.three,
  },
  footer: {
    paddingVertical: Spacing.three,
  },
  listContent: {
    flexGrow: 1,
  },
});
