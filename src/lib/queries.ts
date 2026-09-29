/**
 * React Query hooks over the scoped API. Cache keys carry the server + key
 * so a different session never reads another session's cache.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { extractImageUrls, MAX_BODY_IMAGES } from "./email-html";

import {
  runManageBatch,
  ScopedApi,
  type AttachmentResult,
  type BatchAction,
  type DiscardedResult,
  type DraftSavedResult,
  type DraftUpdatedResult,
  type EmailFull,
  type EmailSummary,
  type Mailbox,
  type ManageResult,
  type SearchFilters,
  type SendResult,
  type ThreadResult,
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
