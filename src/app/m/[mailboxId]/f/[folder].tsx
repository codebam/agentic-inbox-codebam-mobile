import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { Banner } from "@/components/banner";
import { EmailRow } from "@/components/email-row";
import { EmptyState } from "@/components/empty-state";
import { HeaderIconButton } from "@/components/header-icon-button";
import { Loading } from "@/components/loading";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { folderDisplayName } from "@/lib/format";
import { useEmails } from "@/lib/queries";
import { useSession } from "@/lib/session";

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
  const query = useEmails(api, mailboxId ?? "", folder ?? "inbox");

  if (!ready) return <Loading />;
  if (!session || !api) return <Redirect href="/connect" />;
  const ownMailbox = session.kind === "mailbox" ? (session.mailboxId ?? "") : mailboxId;
  if (!mailboxId || (session.kind === "mailbox" && mailboxId !== session.mailboxId)) {
    return <Redirect href={{ pathname: "/m/[mailboxId]", params: { mailboxId: ownMailbox } }} />;
  }

  const emails = query.data?.pages.flat() ?? [];
  const folderName = folderDisplayName(folder ?? "inbox");

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: folderName,
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
        renderItem={({ item }) => (
          <EmailRow
            email={item}
            onPress={() =>
              router.push({
                pathname: "/m/[mailboxId]/e/[emailId]",
                params: { mailboxId, emailId: item.id },
              })
            }
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
});
