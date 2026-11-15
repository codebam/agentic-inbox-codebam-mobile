/**
 * The mailflare-codebam scoped automation API client.
 *
 * Every call is `POST {baseUrl}/api/v1/scoped/<tool>` with a bearer key and
 * the tool's JSON result comes back directly (errors as `{ error }`).
 * Two key kinds are accepted by the surface, and the body differs:
 *
 *  - a mailbox key (ain1_) is bound to one mailbox: calls must NEVER carry
 *    `mailboxId` (the surface answers 400 when they do);
 *  - an app key (ain2_) reaches every mailbox: every mailbox-scoped call
 *    MUST carry `mailboxId` (the surface answers 400 when it doesn't), and
 *    only it may call the all-mailbox reads.
 *
 * This client encodes that contract so no caller can get it wrong. The
 * types mirror the mailflare-codebam facade's wire shapes.
 */

import { plainTextToHtml } from "./email-html";
import { parseToken, type TokenKind } from "./token";

export const DEFAULT_SERVER_URL = "https://email.codebam.ca";

const REQUEST_TIMEOUT_MS = 30_000;

export interface Session {
  baseUrl: string;
  token: string;
  kind: TokenKind;
  /** Bound mailbox for a scoped key; null for a global key. */
  mailboxId: string | null;
}

/** Normalize a server URL: trim, drop trailing slashes, default the scheme to https. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_SERVER_URL;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Build a session from a pasted key, or null when the key is not either wire shape. */
export function createSession(baseUrl: string, token: string): Session | null {
  const trimmed = token.trim();
  const parsed = parseToken(trimmed);
  if (!parsed) return null;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    token: trimmed,
    kind: parsed.kind,
    mailboxId: parsed.mailboxId,
  };
}

/** An error from the API (or the network), carrying the HTTP status when there was one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  /** True when the server rejected the key itself (revoked or invalid). */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface Mailbox {
  id: string;
  address: string;
  displayName?: string | null;
}

/** One list row: system folders are virtual, so `status` carries the folder. */
export interface EmailSummary {
  id: string;
  subject: string | null;
  sender: string | null;
  recipient: string | null;
  date: string;
  read: boolean;
  starred: boolean;
  thread_id: string | null;
  category: string | null;
  /** A user folder id, or null when the message sits in a system folder. */
  folder_id: string | null;
  status: string;
  snippet: string | null;
  /** Present on the all-mailbox rows: the mailbox the message came from. */
  mailbox_id?: string;
}

/** One page of a listing: rows plus the exact total. */
export interface EmailsResult {
  emails: EmailSummary[];
  totalCount: number;
  page?: number;
  limit?: number;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
}

export interface EmailFull extends EmailSummary {
  cc?: string | null;
  bcc?: string | null;
  reply_to?: string | null;
  message_id?: string | null;
  in_reply_to?: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  delivered_to?: string | null;
  delivery_status?: string | null;
  delivery_detail?: string | null;
  labels?: string[];
  attachments?: AttachmentInfo[];
}

export interface ThreadResult {
  thread_id: string;
  emails: EmailFull[];
}

/** Result of get_attachment: metadata plus text content or an omission reason. */
export interface AttachmentResult {
  id: string;
  messageId: string;
  filename: string;
  mimetype: string;
  size: number;
  content: string | null;
  omitted?: string;
  truncated?: boolean;
}

export interface SearchFilters {
  query?: string;
  folder?: string;
  category?: string;
  label?: string;
  from?: string;
  to?: string;
  subject?: string;
  isRead?: boolean;
  isStarred?: boolean;
  hasAttachment?: boolean;
  before?: string;
  after?: string;
  page?: number;
  limit?: number;
}

export interface DraftSavedResult {
  draftId: string;
  revision?: number;
  sourceMessageId?: string | null;
  status?: string;
  message?: string;
}

export interface DraftUpdatedResult {
  draftId: string;
  status: string;
}

export interface SendResult {
  messageId: string;
  status: string;
}

export interface DiscardedResult {
  deleted: boolean;
}

/** One manage-action answer; the fields the UI reads are optional. */
export interface ManageResult {
  status?: string;
  emailId?: string;
  [key: string]: unknown;
}

/** One stored label: a mailbox-wide tag applied by explicit action. */
export interface Label {
  id: string;
  name: string;
  color?: string | null;
  createdAt?: string;
}

export interface LabelListResult {
  labels: Label[];
}

/** Result of add_label / remove_label: the message's labels after the change. */
export interface LabelUpdateResult {
  emailId: string;
  labels: Label[];
}

/** One stored template: an operator-authored reusable snippet. */
export interface TemplateRow {
  id: string;
  name: string;
  subject?: string | null;
  body?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplateListResult {
  templates: TemplateRow[];
}

/** One stored saved search: a named query re-runnable from the search page. */
export interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  createdAt?: string;
}

/** One queued outbound message, as the facade lists it. */
export interface ScheduledSend {
  id: string;
  to: string | null;
  subject: string | null;
  sendAt: string | null;
  status: string;
}

export interface ScheduledSendListResult {
  sends: ScheduledSend[];
}

/** A thread summary built on demand; never stored server-side. */
export interface ThreadSummary {
  thread_id: string;
  summary: string;
}

/** One file to attach to an outbound email (base64-encoded bytes). */
export interface OutboundAttachment {
  filename: string;
  mimetype: string;
  content_base64: string;
}

/** One batch action; each kind maps to the matching single-manage tool. */
export type BatchAction =
  | { kind: "read"; read: boolean }
  | { kind: "star"; starred: boolean }
  | { kind: "move"; folderId: string }
  | { kind: "delete"; permanent: boolean };

export interface ComposeBody {
  to: string;
  subject: string;
  /** Plain text; converted to the composer's canonical HTML before sending. */
  body: string;
}

/**
 * The folder a row sits in, as a display/navigation key: a user folder id
 * when set, else the system folder synthesized from the message status.
 */
export function folderOf(row: Pick<EmailSummary, "folder_id" | "status">): string {
  if (row.folder_id) return row.folder_id;
  switch (row.status) {
    case "sent": return "sent";
    case "draft": return "draft";
    case "archived": return "archive";
    case "spam": return "spam";
    case "trash": return "trash";
    case "queued": return "scheduled";
    default: return "inbox";
  }
}

function cleanFilters(filters: SearchFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

export class ScopedApi {
  constructor(readonly session: Session) {}

  get host(): string {
    try {
      return new URL(this.session.baseUrl).host;
    } catch {
      return this.session.baseUrl;
    }
  }

  /**
   * The body of one mailbox-scoped call. An app key names the mailbox per
   * call; a scoped key must not name one. Programming errors are thrown
   * before any request goes out rather than surfacing as a server 400.
   */
  private mailboxBody(mailboxId: string | null, args: Record<string, unknown>): Record<string, unknown> {
    if (this.session.kind === "app") {
      if (!mailboxId) throw new Error("This key reaches every mailbox; a mailbox must be named for this call.");
      return { ...args, mailboxId };
    }
    if (mailboxId && mailboxId !== this.session.mailboxId) {
      throw new Error("This key is scoped to a single mailbox.");
    }
    return { ...args };
  }

  private assertAppKey(tool: string): void {
    if (this.session.kind !== "app") {
      throw new Error(`Only a global key can call ${tool}.`);
    }
  }

  private async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.session.baseUrl}/api/v1/scoped/${tool}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.session.token}`,
        },
        body: JSON.stringify(args),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ApiError(
        aborted
          ? `The request to ${this.host} timed out.`
          : `Couldn't reach ${this.host}. Check the server URL and your connection.`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const record = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

    if (!response.ok) {
      const message = typeof record.error === "string" ? record.error : `Request failed (${response.status})`;
      throw new ApiError(message, response.status);
    }
    if (typeof record.error === "string" && record.error) {
      throw new ApiError(record.error, response.status);
    }
    return record as T;
  }

  // ── mailbox-scoped tools ─────────────────────────────────────────────

  async listEmails(
    mailboxId: string | null,
    folder = "inbox",
    options: { page?: number; limit?: number; category?: string } = {},
  ): Promise<EmailsResult> {
    const args: Record<string, unknown> = {
      folder,
      page: options.page ?? 1,
      limit: options.limit ?? 25,
    };
    if (options.category) args.category = options.category;
    return this.call<EmailsResult>("list_emails", this.mailboxBody(mailboxId, args));
  }

  async getEmail(mailboxId: string | null, emailId: string): Promise<EmailFull> {
    return this.call<EmailFull>("get_email", this.mailboxBody(mailboxId, { emailId }));
  }

  async getThread(mailboxId: string | null, threadId: string): Promise<ThreadResult> {
    return this.call<ThreadResult>("get_thread", this.mailboxBody(mailboxId, { threadId }));
  }

  async searchEmails(mailboxId: string | null, filters: SearchFilters): Promise<EmailsResult> {
    return this.call<EmailsResult>("search_emails", this.mailboxBody(mailboxId, cleanFilters(filters)));
  }

  async getAttachment(mailboxId: string | null, attachmentId: string): Promise<AttachmentResult> {
    return this.call<AttachmentResult>("get_attachment", this.mailboxBody(mailboxId, { attachmentId }));
  }

  // ── manage tools ─────────────────────────────────────────────────────

  async markEmailRead(mailboxId: string | null, emailId: string, read: boolean): Promise<ManageResult> {
    return this.call<ManageResult>("mark_email_read", this.mailboxBody(mailboxId, { emailId, read }));
  }

  async starEmail(mailboxId: string | null, emailId: string, starred: boolean): Promise<ManageResult> {
    return this.call<ManageResult>("star_email", this.mailboxBody(mailboxId, { emailId, starred }));
  }

  async moveEmail(mailboxId: string | null, emailId: string, folderId: string): Promise<ManageResult> {
    return this.call<ManageResult>("move_email", this.mailboxBody(mailboxId, { emailId, folderId }));
  }

  async deleteEmail(mailboxId: string | null, emailId: string, permanent = false): Promise<ManageResult> {
    // The surface refuses a permanent delete without an explicit confirm;
    // the app only reaches permanent after its own confirmation dialog.
    const args: Record<string, unknown> = { emailId, permanent };
    if (permanent) args.confirm = true;
    return this.call<ManageResult>("delete_email", this.mailboxBody(mailboxId, args));
  }

  async snoozeEmail(mailboxId: string | null, emailId: string, until: string): Promise<ManageResult> {
    return this.call<ManageResult>("snooze_email", this.mailboxBody(mailboxId, { emailId, until }));
  }

  async unsnoozeEmail(mailboxId: string | null, emailId: string): Promise<ManageResult> {
    return this.call<ManageResult>("unsnooze_email", this.mailboxBody(mailboxId, { emailId }));
  }

  async setSenderPolicy(mailboxId: string | null, emailId: string, policy: "allow" | "block"): Promise<ManageResult> {
    return this.call<ManageResult>("set_sender_policy", this.mailboxBody(mailboxId, { emailId, action: policy }));
  }

  async unsubscribeEmail(mailboxId: string | null, emailId: string): Promise<ManageResult> {
    return this.call<ManageResult>("unsubscribe_email", this.mailboxBody(mailboxId, { emailId }));
  }

  async draftReply(
    mailboxId: string | null,
    input: { originalEmailId: string; to?: string; subject: string; body: string },
  ): Promise<DraftSavedResult> {
    const args: Record<string, unknown> = {
      originalEmailId: input.originalEmailId,
      subject: input.subject,
      bodyHtml: plainTextToHtml(input.body),
    };
    if (input.to) args.to = input.to;
    return this.call<DraftSavedResult>("draft_reply", this.mailboxBody(mailboxId, args));
  }

  async createDraft(
    mailboxId: string | null,
    input: { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string },
  ): Promise<DraftSavedResult> {
    const args: Record<string, unknown> = {
      to: input.to,
      subject: input.subject,
      bodyHtml: plainTextToHtml(input.body),
    };
    if (input.inReplyTo) args.in_reply_to = input.inReplyTo;
    if (input.threadId) args.thread_id = input.threadId;
    return this.call<DraftSavedResult>("create_draft", this.mailboxBody(mailboxId, args));
  }

  async updateDraft(
    mailboxId: string | null,
    input: { draftId: string; to?: string; subject?: string; body?: string },
  ): Promise<DraftUpdatedResult> {
    const args: Record<string, unknown> = { draftId: input.draftId };
    // Only fields that actually carry a value are sent: the tool falls back
    // to the stored draft's own values for anything absent, and an empty
    // string would overwrite them.
    if (input.to !== undefined && input.to.trim()) args.to = input.to.trim();
    if (input.subject !== undefined && input.subject.trim()) args.subject = input.subject.trim();
    if (input.body !== undefined && input.body.trim()) args.bodyHtml = plainTextToHtml(input.body);
    return this.call<DraftUpdatedResult>("update_draft", this.mailboxBody(mailboxId, args));
  }

  async discardDraft(mailboxId: string | null, draftId: string): Promise<DiscardedResult> {
    return this.call<DiscardedResult>("discard_draft", this.mailboxBody(mailboxId, { draftId }));
  }

  async sendReply(
    mailboxId: string | null,
    input: { originalEmailId: string; to: string; subject: string; body: string },
  ): Promise<SendResult> {
    return this.call<SendResult>(
      "send_reply",
      this.mailboxBody(mailboxId, {
        originalEmailId: input.originalEmailId,
        to: input.to,
        subject: input.subject,
        bodyHtml: plainTextToHtml(input.body),
      }),
    );
  }

  async sendEmail(
    mailboxId: string | null,
    input: { to: string; cc?: string; bcc?: string; subject: string; body: string; attachments?: OutboundAttachment[] },
  ): Promise<SendResult> {
    const args: Record<string, unknown> = {
      to: input.to,
      subject: input.subject,
      bodyHtml: plainTextToHtml(input.body),
    };
    if (input.cc) args.cc = input.cc;
    if (input.bcc) args.bcc = input.bcc;
    if (input.attachments?.length) {
      args.attachments = input.attachments.map(({ filename, mimetype, content_base64 }) => ({ filename, mimetype, content_base64 }));
    }
    return this.call<SendResult>("send_email", this.mailboxBody(mailboxId, args));
  }

  // ── label tools ──────────────────────────────────────────────────────

  async listLabels(mailboxId: string | null): Promise<LabelListResult> {
    return this.call<LabelListResult>("list_labels", this.mailboxBody(mailboxId, {}));
  }

  async createLabel(mailboxId: string | null, input: { name: string; color?: string }): Promise<{ label: Label }> {
    const args: Record<string, unknown> = { name: input.name };
    if (input.color) args.color = input.color;
    return this.call<{ label: Label }>("create_label", this.mailboxBody(mailboxId, args));
  }

  async updateLabel(
    mailboxId: string | null,
    input: { label: string; name?: string; color?: string },
  ): Promise<{ label: Label }> {
    const args: Record<string, unknown> = { label: input.label };
    if (input.name !== undefined) args.name = input.name;
    if (input.color !== undefined) args.color = input.color;
    return this.call<{ label: Label }>("update_label", this.mailboxBody(mailboxId, args));
  }

  async deleteLabel(mailboxId: string | null, label: string): Promise<{ deleted: boolean }> {
    return this.call<{ deleted: boolean }>("delete_label", this.mailboxBody(mailboxId, { label }));
  }

  async addLabel(mailboxId: string | null, emailId: string, label: string): Promise<LabelUpdateResult> {
    return this.call<LabelUpdateResult>("add_label", this.mailboxBody(mailboxId, { emailId, label }));
  }

  async removeLabel(mailboxId: string | null, emailId: string, label: string): Promise<LabelUpdateResult> {
    return this.call<LabelUpdateResult>("remove_label", this.mailboxBody(mailboxId, { emailId, label }));
  }

  // ── template tools ───────────────────────────────────────────────────

  async listTemplates(mailboxId: string | null): Promise<TemplateListResult> {
    return this.call<TemplateListResult>("list_templates", this.mailboxBody(mailboxId, {}));
  }

  async createTemplate(
    mailboxId: string | null,
    input: { name: string; subject?: string; body: string },
  ): Promise<{ template: TemplateRow }> {
    const args: Record<string, unknown> = { name: input.name, body: input.body };
    if (input.subject) args.subject = input.subject;
    return this.call<{ template: TemplateRow }>("create_template", this.mailboxBody(mailboxId, args));
  }

  async updateTemplate(
    mailboxId: string | null,
    input: { templateId: string; name?: string; subject?: string; body?: string },
  ): Promise<{ template: TemplateRow }> {
    const args: Record<string, unknown> = { templateId: input.templateId };
    if (input.name !== undefined) args.name = input.name;
    if (input.subject !== undefined) args.subject = input.subject;
    if (input.body !== undefined) args.body = input.body;
    return this.call<{ template: TemplateRow }>("update_template", this.mailboxBody(mailboxId, args));
  }

  async deleteTemplate(mailboxId: string | null, templateId: string): Promise<{ deleted: boolean }> {
    return this.call<{ deleted: boolean }>("delete_template", this.mailboxBody(mailboxId, { templateId }));
  }

  // ── saved-search tools ───────────────────────────────────────────────

  async listSavedSearches(mailboxId: string | null): Promise<{ searches: SavedSearchRow[] }> {
    return this.call<{ searches: SavedSearchRow[] }>(
      "list_saved_searches",
      this.mailboxBody(mailboxId, {}),
    );
  }

  async createSavedSearch(
    mailboxId: string | null,
    input: { name: string; query: string },
  ): Promise<{ search: SavedSearchRow }> {
    return this.call<{ search: SavedSearchRow }>(
      "create_saved_search",
      this.mailboxBody(mailboxId, { name: input.name, query: input.query }),
    );
  }

  async updateSavedSearch(
    mailboxId: string | null,
    input: { searchId: string; name?: string; query?: string },
  ): Promise<{ search: SavedSearchRow }> {
    const args: Record<string, unknown> = { searchId: input.searchId };
    if (input.name !== undefined) args.name = input.name;
    if (input.query !== undefined) args.query = input.query;
    return this.call<{ search: SavedSearchRow }>("update_saved_search", this.mailboxBody(mailboxId, args));
  }

  async deleteSavedSearch(mailboxId: string | null, searchId: string): Promise<{ deleted: boolean }> {
    return this.call<{ deleted: boolean }>("delete_saved_search", this.mailboxBody(mailboxId, { searchId }));
  }

  // ── thread tools ─────────────────────────────────────────────────────

  async muteThread(mailboxId: string | null, threadId: string): Promise<{ muted: boolean }> {
    return this.call<{ muted: boolean }>("mute_thread", this.mailboxBody(mailboxId, { threadId }));
  }

  async unmuteThread(mailboxId: string | null, threadId: string): Promise<{ muted: boolean }> {
    return this.call<{ muted: boolean }>("unmute_thread", this.mailboxBody(mailboxId, { threadId }));
  }

  async markThreadRead(mailboxId: string | null, threadId: string): Promise<ManageResult> {
    return this.call<ManageResult>("mark_thread_read", this.mailboxBody(mailboxId, { threadId }));
  }

  async summarizeThread(mailboxId: string | null, threadId: string): Promise<ThreadSummary> {
    return this.call<ThreadSummary>("summarize_thread", this.mailboxBody(mailboxId, { threadId }));
  }

  // ── trash tools ──────────────────────────────────────────────────────

  async restoreEmail(mailboxId: string | null, emailId: string): Promise<ManageResult> {
    return this.call<ManageResult>("restore_email", this.mailboxBody(mailboxId, { emailId }));
  }

  async emptyTrash(mailboxId: string | null): Promise<{ deleted: number }> {
    return this.call<{ deleted: number }>("empty_trash", this.mailboxBody(mailboxId, { confirm: true }));
  }

  // ── scheduled-send tools ─────────────────────────────────────────────

  async listScheduledSends(mailboxId: string | null): Promise<ScheduledSendListResult> {
    return this.call<ScheduledSendListResult>(
      "list_scheduled_sends",
      this.mailboxBody(mailboxId, {}),
    );
  }

  async scheduleSend(
    mailboxId: string | null,
    input: { to: string; subject: string; body: string; sendAt: string; cc?: string; bcc?: string },
  ): Promise<{ id: string; status: string; sendAt: string }> {
    const args: Record<string, unknown> = {
      to: input.to,
      subject: input.subject,
      bodyHtml: plainTextToHtml(input.body),
      sendAt: input.sendAt,
    };
    if (input.cc) args.cc = input.cc;
    if (input.bcc) args.bcc = input.bcc;
    return this.call<{ id: string; status: string; sendAt: string }>("schedule_send", this.mailboxBody(mailboxId, args));
  }

  async retryScheduledSend(
    mailboxId: string | null,
    scheduledSendId: string,
  ): Promise<{ id: string; status: string }> {
    return this.call<{ id: string; status: string }>(
      "retry_scheduled_send",
      this.mailboxBody(mailboxId, { scheduledSendId }),
    );
  }

  // ── app-only tools (global key) ──────────────────────────────────────

  async listMailboxes(): Promise<Mailbox[]> {
    this.assertAppKey("list_mailboxes");
    return this.call<Mailbox[]>("list_mailboxes", {});
  }

  async searchAllMailboxes(filters: SearchFilters): Promise<EmailsResult> {
    this.assertAppKey("search_all_mailboxes");
    return this.call<EmailsResult>("search_all_mailboxes", cleanFilters(filters));
  }

  /**
   * Every mailbox's mail merged by date (newest first) — the All Accounts
   * listing. A folder applies to every mailbox; null (or "all") merges
   * every folder. Each row carries `mailbox_id`.
   */
  async listAllEmails(
    folder: string | null,
    options: { page?: number; limit?: number } = {},
  ): Promise<EmailsResult> {
    this.assertAppKey("list_all_emails");
    const args: Record<string, unknown> = {
      page: options.page ?? 1,
      limit: options.limit ?? 25,
    };
    if (folder && folder !== "all") args.folder = folder;
    return this.call<EmailsResult>("list_all_emails", args);
  }
}

/**
 * Apply one manage action to many messages, one call at a time, so a phone
 * batch needs no server-side bulk tool. Stops at the first refusal and
 * names how many messages the action did land on, because a partial batch
 * is the case worth reporting. `onProgress` reports after each success.
 */
export async function runManageBatch(
  api: ScopedApi,
  mailboxId: string | null,
  ids: string[],
  action: BatchAction,
  onProgress?: (done: number, total: number) => void,
): Promise<{ done: number }> {
  let done = 0;
  for (const id of ids) {
    try {
      if (action.kind === "read") {
        await api.markEmailRead(mailboxId, id, action.read);
      } else if (action.kind === "star") {
        await api.starEmail(mailboxId, id, action.starred);
      } else if (action.kind === "move") {
        await api.moveEmail(mailboxId, id, action.folderId);
      } else {
        await api.deleteEmail(mailboxId, id, action.permanent);
      }
      done += 1;
      onProgress?.(done, ids.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The action failed.";
      throw new Error(`Stopped after ${done} of ${ids.length}: ${message}`);
    }
  }
  return { done };
}

/**
 * Restore many trashed messages to the Inbox, one call at a time, mirroring
 * runManageBatch: stops at the first refusal and names how many messages
 * were restored, because a partial restore is the case worth reporting.
 * `onProgress` reports after each success.
 */
export async function runRestoreBatch(
  api: ScopedApi,
  mailboxId: string | null,
  ids: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ done: number }> {
  let done = 0;
  for (const id of ids) {
    try {
      await api.restoreEmail(mailboxId, id);
      done += 1;
      onProgress?.(done, ids.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The action failed.";
      throw new Error(`Stopped after ${done} of ${ids.length}: ${message}`);
    }
  }
  return { done };
}