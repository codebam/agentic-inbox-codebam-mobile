/**
 * React Query hooks over the scoped API. Cache keys carry the server + key
 * so a different session never reads another session's cache.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { extractImageUrls, MAX_BODY_IMAGES } from "./email-html";

import {
  runManageBatch,
  runRestoreBatch,
  ScopedApi,
  type AttachmentResult,
  type BatchAction,
  type DiscardedResult,
  type DraftSavedResult,
  type DraftUpdatedResult,
  type EmailFull,
  type EmailSummary,
  type EmailsResult,
  type Label,
  type Mailbox,
  type ManageResult,
  type SavedSearchRow,
  type ScheduledSend,
  type SearchFilters,
  type SendResult,
  type TemplateRow,
  type ThreadResult,
  type ThreadSummary,
} from "./api";

export const PAGE_SIZE = 25;

function sessionScope(api: ScopedApi): string[] {
  return [api.session.baseUrl, api.session.token.slice(-8)];
}

function requireApi(api: ScopedApi | null): ScopedApi {
  if (!api) throw new Error("Not connected");
  return api;
}

async function invalidateFolder(client: QueryClient, api: ScopedApi | null, mailboxId: string, folder: string) {
  if (!api) return;
  await client.invalidateQueries({ queryKey: ["emails", ...sessionScope(api), mailboxId, folder] });
}

/** After any manage action: refresh the message, its thread and every list. */
async function invalidateMailbox(client: QueryClient, api: ScopedApi | null, mailboxId: string) {
  if (!api) return;
  const scope = sessionScope(api);
  await Promise.all([
    client.invalidateQueries({ queryKey: ["emails", ...scope, mailboxId] }),
    client.invalidateQueries({ queryKey: ["email", ...scope, mailboxId] }),
    client.invalidateQueries({ queryKey: ["thread", ...scope, mailboxId] }),
    client.invalidateQueries({ queryKey: ["search", ...scope] }),
  ]);
}

export function useMailboxes(api: ScopedApi | null) {
  return useQuery({
    queryKey: ["mailboxes", ...(api ? sessionScope(api) : ["none"])],
    enabled: Boolean(api) && api?.session.kind === "app",
    queryFn: async (): Promise<Mailbox[]> => requireApi(api).listMailboxes(),
  });
}

/**
 * The All Accounts listing: every mailbox's mail merged by date, newest
 * first, each row tagged by its mailbox. Only a global key may call it.
 */
export function useAllEmails(api: ScopedApi | null, folder: string | null) {
  return useInfiniteQuery({
    queryKey: ["all-emails", ...(api ? sessionScope(api) : ["none"]), folder ?? "all"],
    enabled: Boolean(api) && api?.session.kind === "app",
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<EmailsResult> =>
      requireApi(api).listAllEmails(folder, { page: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.emails.length > 0 && allPages.length * PAGE_SIZE < lastPage.totalCount
        ? allPages.length + 1
        : undefined,
  });
}

export function useEmails(api: ScopedApi | null, mailboxId: string, folder: string) {
  return useInfiniteQuery({
    queryKey: ["emails", ...(api ? sessionScope(api) : ["none"]), mailboxId, folder],
    enabled: Boolean(api) && Boolean(mailboxId),
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<EmailSummary[]> =>
      requireApi(api).listEmails(mailboxId, folder, { page: pageParam, limit: PAGE_SIZE }),
    getNextPageParam: (lastPage, allPages) => (lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined),
  });
}

export function useEmail(api: ScopedApi | null, mailboxId: string, emailId: string) {
  return useQuery({
    queryKey: ["email", ...(api ? sessionScope(api) : ["none"]), mailboxId, emailId],
    enabled: Boolean(api) && Boolean(mailboxId) && Boolean(emailId),
    queryFn: async (): Promise<EmailFull> => requireApi(api).getEmail(mailboxId, emailId),
  });
}

export function useThread(api: ScopedApi | null, mailboxId: string, threadId: string) {
  return useQuery({
    queryKey: ["thread", ...(api ? sessionScope(api) : ["none"]), mailboxId, threadId],
    enabled: Boolean(api) && Boolean(mailboxId) && Boolean(threadId),
    queryFn: async (): Promise<ThreadResult> => requireApi(api).getThread(mailboxId, threadId),
  });
}

/**
 * Search. A null mailboxId searches every mailbox — only a global key may
 * do that; callers pass a concrete mailbox for scoped keys.
 */
export function useSearch(api: ScopedApi | null, mailboxId: string | null, filters: SearchFilters) {
  const hasQuery = Boolean(filters.query && filters.query.trim());
  return useQuery({
    queryKey: ["search", ...(api ? sessionScope(api) : ["none"]), mailboxId ?? "*", JSON.stringify(filters)],
    enabled: Boolean(api) && hasQuery,
    queryFn: async (): Promise<EmailSummary[]> => {
      const client = requireApi(api);
      const target = mailboxId;
      if (target === null) return client.searchAllMailboxes(filters);
      return client.searchEmails(target, filters);
    },
  });
}

export function useAttachment(api: ScopedApi | null, mailboxId: string, attachmentId: string | null) {
  return useQuery({
    queryKey: ["attachment", ...(api ? sessionScope(api) : ["none"]), mailboxId, attachmentId ?? ""],
    enabled: Boolean(api) && Boolean(mailboxId) && Boolean(attachmentId),
    queryFn: async (): Promise<AttachmentResult> => {
      const client = requireApi(api);
      const id = attachmentId;
      if (id === null) throw new Error("No attachment selected");
      return client.getAttachment(mailboxId, id);
    },
  });
}

// ── mutations ────────────────────────────────────────────────────────

export function useDraftReply(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { originalEmailId: string; to?: string; subject: string; body: string }): Promise<DraftSavedResult> =>
      requireApi(api).draftReply(mailboxId, input),
    onSuccess: () => invalidateFolder(client, api, mailboxId, "draft"),
  });
}

export function useCreateDraft(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { to: string; subject: string; body: string }): Promise<DraftSavedResult> =>
      requireApi(api).createDraft(mailboxId, input),
    onSuccess: () => invalidateFolder(client, api, mailboxId, "draft"),
  });
}

export function useUpdateDraft(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { draftId: string; to?: string; subject?: string; body?: string }): Promise<DraftUpdatedResult> =>
      requireApi(api).updateDraft(mailboxId, input),
    onSuccess: async (result) => {
      await invalidateFolder(client, api, mailboxId, "draft");
      if (api) {
        await client.invalidateQueries({ queryKey: ["email", ...sessionScope(api), mailboxId, result.oldDraftId] });
      }
    },
  });
}

export function useDiscardDraft(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string): Promise<DiscardedResult> => requireApi(api).discardDraft(mailboxId, draftId),
    onSuccess: async (_result, draftId) => {
      await invalidateFolder(client, api, mailboxId, "draft");
      if (api) {
        await client.invalidateQueries({ queryKey: ["email", ...sessionScope(api), mailboxId, draftId] });
      }
    },
  });
}

export function useSendReply(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { originalEmailId: string; to: string; subject: string; body: string }): Promise<SendResult> =>
      requireApi(api).sendReply(mailboxId, input),
    onSuccess: () => invalidateFolder(client, api, mailboxId, "sent"),
  });
}

export function useSendEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { to: string; subject: string; body: string }): Promise<SendResult> =>
      requireApi(api).sendEmail(mailboxId, input),
    onSuccess: () => invalidateFolder(client, api, mailboxId, "sent"),
  });
}

// ── manage actions ───────────────────────────────────────────────────

export function useMarkEmailRead(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; read: boolean }): Promise<ManageResult> =>
      requireApi(api).markEmailRead(mailboxId, input.emailId, input.read),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useStarEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; starred: boolean }): Promise<ManageResult> =>
      requireApi(api).starEmail(mailboxId, input.emailId, input.starred),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useMoveEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; folderId: string }): Promise<ManageResult> =>
      requireApi(api).moveEmail(mailboxId, input.emailId, input.folderId),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useDeleteEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; permanent?: boolean }): Promise<ManageResult> =>
      requireApi(api).deleteEmail(mailboxId, input.emailId, input.permanent ?? false),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useSnoozeEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; until: string }): Promise<ManageResult> =>
      requireApi(api).snoozeEmail(mailboxId, input.emailId, input.until),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useUnsnoozeEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (emailId: string): Promise<ManageResult> =>
      requireApi(api).unsnoozeEmail(mailboxId, emailId),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useSetSenderPolicy(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; policy: "allow" | "block" }): Promise<ManageResult> =>
      requireApi(api).setSenderPolicy(mailboxId, input.emailId, input.policy),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useUnsubscribeEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (emailId: string): Promise<ManageResult> =>
      requireApi(api).unsubscribeEmail(mailboxId, emailId),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

/**
 * One manage action over many messages, sequential (see runManageBatch).
 * Invalidates on settled, not just success: a batch that stopped part-way
 * changed real messages and the lists must show the truth.
 */
export function useManageBatch(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ids: string[];
      action: BatchAction;
      onProgress?: (done: number, total: number) => void;
    }): Promise<{ done: number }> =>
      runManageBatch(requireApi(api), mailboxId, input.ids, input.action, input.onProgress),
    onSettled: () => invalidateMailbox(client, api, mailboxId),
  });
}

// ── labels ───────────────────────────────────────────────────────────

export function useLabels(api: ScopedApi | null, mailboxId: string, enabled = true) {
  return useQuery({
    queryKey: ["labels", ...(api ? sessionScope(api) : ["none"]), mailboxId],
    enabled: Boolean(api) && Boolean(mailboxId) && enabled,
    queryFn: async (): Promise<Label[]> => (await requireApi(api).listLabels(mailboxId)).labels,
  });
}

export function useCreateLabel(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color?: string }): Promise<Label> =>
      requireApi(api).createLabel(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["labels"] }),
  });
}

export function useUpdateLabel(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { label: string; name?: string; color?: string }): Promise<Label> =>
      requireApi(api).updateLabel(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["labels"] }),
  });
}

export function useDeleteLabel(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (label: string): Promise<{ ok: boolean }> =>
      requireApi(api).deleteLabel(mailboxId, label),
    onSuccess: () => client.invalidateQueries({ queryKey: ["labels"] }),
  });
}

export function useAddLabel(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; label: string }) =>
      requireApi(api).addLabel(mailboxId, input.emailId, input.label),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useRemoveLabel(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { emailId: string; label: string }) =>
      requireApi(api).removeLabel(mailboxId, input.emailId, input.label),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

// ── templates ────────────────────────────────────────────────────────

export function useTemplates(api: ScopedApi | null, mailboxId: string, enabled = true) {
  return useQuery({
    queryKey: ["templates", ...(api ? sessionScope(api) : ["none"]), mailboxId],
    enabled: Boolean(api) && Boolean(mailboxId) && enabled,
    queryFn: async (): Promise<TemplateRow[]> =>
      (await requireApi(api).listTemplates(mailboxId)).templates,
  });
}

export function useCreateTemplate(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; subject?: string; body: string }): Promise<TemplateRow> =>
      requireApi(api).createTemplate(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useUpdateTemplate(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      templateId: string;
      name?: string;
      subject?: string;
      body?: string;
    }): Promise<TemplateRow> => requireApi(api).updateTemplate(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useDeleteTemplate(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string): Promise<{ ok: boolean }> =>
      requireApi(api).deleteTemplate(mailboxId, templateId),
    onSuccess: () => client.invalidateQueries({ queryKey: ["templates"] }),
  });
}

// ── saved searches ───────────────────────────────────────────────────

export function useSavedSearches(api: ScopedApi | null, mailboxId: string, enabled = true) {
  return useQuery({
    queryKey: ["saved-searches", ...(api ? sessionScope(api) : ["none"]), mailboxId],
    enabled: Boolean(api) && Boolean(mailboxId) && enabled,
    queryFn: async (): Promise<SavedSearchRow[]> =>
      (await requireApi(api).listSavedSearches(mailboxId)).searches,
  });
}

export function useCreateSavedSearch(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; query: string }): Promise<SavedSearchRow> =>
      requireApi(api).createSavedSearch(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["saved-searches"] }),
  });
}

export function useUpdateSavedSearch(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { searchId: string; name?: string; query?: string }): Promise<SavedSearchRow> =>
      requireApi(api).updateSavedSearch(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["saved-searches"] }),
  });
}

export function useDeleteSavedSearch(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (searchId: string): Promise<{ ok: boolean }> =>
      requireApi(api).deleteSavedSearch(mailboxId, searchId),
    onSuccess: () => client.invalidateQueries({ queryKey: ["saved-searches"] }),
  });
}

// ── thread actions ───────────────────────────────────────────────────

export function useMuteThread(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; muted: boolean }): Promise<{ muted: boolean }> => {
      const clientApi = requireApi(api);
      return input.muted
        ? clientApi.muteThread(mailboxId, input.threadId)
        : clientApi.unmuteThread(mailboxId, input.threadId);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["thread"] }),
  });
}

export function useMarkThreadRead(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string): Promise<ManageResult> =>
      requireApi(api).markThreadRead(mailboxId, threadId),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useSummarizeThread(api: ScopedApi | null, mailboxId: string) {
  return useMutation({
    mutationFn: async (threadId: string): Promise<ThreadSummary> =>
      requireApi(api).summarizeThread(mailboxId, threadId),
  });
}

// ── trash ────────────────────────────────────────────────────────────

export function useRestoreEmail(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (emailId: string): Promise<ManageResult> =>
      requireApi(api).restoreEmail(mailboxId, emailId),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

/** Restore many trashed messages, sequential (see runRestoreBatch). */
export function useRestoreBatch(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      ids: string[];
      onProgress?: (done: number, total: number) => void;
    }): Promise<{ done: number }> =>
      runRestoreBatch(requireApi(api), mailboxId, input.ids, input.onProgress),
    onSettled: () => invalidateMailbox(client, api, mailboxId),
  });
}

export function useEmptyTrash(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ purged: number }> => requireApi(api).emptyTrash(mailboxId),
    onSuccess: () => invalidateMailbox(client, api, mailboxId),
  });
}

// ── scheduled sends ──────────────────────────────────────────────────

export function useScheduledSends(api: ScopedApi | null, mailboxId: string) {
  return useQuery({
    queryKey: ["scheduled-sends", ...(api ? sessionScope(api) : ["none"]), mailboxId],
    enabled: Boolean(api) && Boolean(mailboxId),
    queryFn: async (): Promise<ScheduledSend[]> =>
      (await requireApi(api).listScheduledSends(mailboxId)).sends,
  });
}

export function useScheduleSend(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      to: string;
      subject: string;
      body: string;
      sendAt: string;
    }): Promise<ScheduledSend> => requireApi(api).scheduleSend(mailboxId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["scheduled-sends"] }),
  });
}

export function useCancelScheduledSend(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (scheduledSendId: string) =>
      requireApi(api).cancelScheduledSend(mailboxId, scheduledSendId),
    onSuccess: () => client.invalidateQueries({ queryKey: ["scheduled-sends"] }),
  });
}

export function useRetryScheduledSend(api: ScopedApi | null, mailboxId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (scheduledSendId: string) =>
      requireApi(api).retryScheduledSend(mailboxId, scheduledSendId),
    onSuccess: () => client.invalidateQueries({ queryKey: ["scheduled-sends"] }),
  });
}

/**
 * The remote images of one message, fetched through the scoped get_image
 * tool and keyed by URL so the document builder can inline exactly the
 * ones that loaded. Sequential: an image is small, and ordering keeps the
 * deployment's per-request accounting simple. A failure only drops that
 * image back to its text placeholder.
 */
export function useEmailImages(api: ScopedApi | null, mailboxId: string, bodyHtml: string | null | undefined) {
  const urls = useMemo(() => extractImageUrls(bodyHtml ?? "").slice(0, MAX_BODY_IMAGES), [bodyHtml]);
  return useQuery({
    queryKey: ["email-images", api?.session.baseUrl ?? "", mailboxId, urls],
    enabled: Boolean(api && mailboxId && urls.length > 0),
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const scoped = requireApi(api);
      const images = new Map<string, string>();
      let failed = 0;
      for (const url of urls) {
        try {
          const result = await scoped.getImage(mailboxId, url);
          if (result.dataBase64 && result.contentType) {
            images.set(url, `data:${result.contentType};base64,${result.dataBase64}`);
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }
      return { images, failed, total: urls.length };
    },
  });
}
