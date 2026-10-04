/**
 * The agentic-inbox scoped automation API client.
 *
 * Every call is `POST {baseUrl}/api/v1/scoped/<tool>` with a bearer key.
 * Two key kinds are accepted by the surface, and the body differs:
 *
 *  - a mailbox key (ain1_) is bound to one mailbox: calls must NEVER carry
 *    `mailboxId` (the surface answers 400 when they do);
 *  - an app key (ain2_) reaches every mailbox: every mailbox-scoped call
 *    MUST carry `mailboxId` (the surface answers 400 when it doesn't), and
 *    only it may call the two all-mailbox reads.
 *
 * This client encodes that contract so no caller can get it wrong.
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
  email: string;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  content_id?: string | null;
  disposition?: string | null;
}

export interface EmailSummary {
  id: string;
  subject?: string | null;
  sender?: string | null;
  recipient?: string | null;
  envelope_recipient?: string | null;
  cc?: string | null;
  bcc?: string | null;
  date: string;
  read: boolean;
  starred: boolean;
  in_reply_to?: string | null;
  thread_id?: string | null;
  folder_id: string;
  folder_name?: string | null;
  category?: string | null;
  snippet?: string | null;
  /** Present on search_all_mailboxes rows: the mailbox the message came from. */
  mailboxId?: string;
}

export interface EmailFull extends EmailSummary {
  body?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  reply_to?: string | null;
  attachments?: AttachmentInfo[];
  trashed_at?: string | null;
  /** Raw List-Unsubscribe header; present only when the sender set one. */
  list_unsubscribe?: string | null;
  /** RFC 8058 one-click marker; the Unsubscribe action needs it and an https target. */
  list_unsubscribe_post?: string | null;
}

export interface ThreadResult {
  thread_id: string;
  message_count: number;
  messages: EmailFull[];
  /** Whether new mail in the thread is skipped by notifications. */
  muted?: boolean;
}

/** Result of get_attachment: metadata plus text content or an omission reason. */
export interface AttachmentResult {
  mailboxId: string;
  attachment: AttachmentInfo & { emailId?: string };
  content:
    | { kind: "text"; text: string; truncated: boolean }
    | { kind: "omitted"; reason: string };
}

export interface SearchFilters {
  query?: string;
  folder?: string;
  category?: string;
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
  status: string;
  draftId: string;
  message?: string;
  signatureApplied?: boolean;
}

export interface DraftUpdatedResult {
  status: string;
  newDraftId: string;
  oldDraftId: string;
  message?: string;
}

export interface SendResult {
  status: "sent";
  messageId: string;
  message?: string;
}

export interface DiscardedResult {
  status: string;
  draftId: string;
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
  created_at?: string;
}

export interface LabelListResult {
  mailboxId: string;
  labels: Label[];
  note?: string;
}

/** Result of add_label / remove_label: the message's labels after the change. */
export interface LabelUpdateResult {
  status: string;
  emailId: string;
  label: Label;
  labels: Label[];
}

/** One stored template: an operator-authored reusable snippet. */
export interface TemplateRow {
  id: string;
  name: string;
  subject?: string | null;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TemplateListResult {
  mailboxId: string;
  templates: TemplateRow[];
}

/** One stored saved search: a named query re-runnable from the search page. */
export interface SavedSearchRow {
  id: string;
  name: string;
  query: string;
  created_at?: string;
}

/** The stored send parameters of one scheduled send, as far as the app reads them. */
export interface ScheduledSendPayload {
  to?: string | string[];
  subject?: string;
  from?: string;
  [key: string]: unknown;
}

/** One queued outbound message. */
export interface ScheduledSend {
  id: string;
  draft_id: string | null;
  send_at: string;
  status: string;
  payload: ScheduledSendPayload | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface ScheduledSendListResult {
  mailboxId: string;
  sends: ScheduledSend[];
  totalCount: number;
}

export interface ScheduledSendActionResult {
  status: string;
  send: ScheduledSend;
}

/** A thread summary built on demand; never stored server-side. */
export interface ThreadSummary {
  text: string;
  message_count: number;
  truncated: boolean;
  model: string;
}

/** One batch action; each kind maps to the matching single-manage tool. */
export type BatchAction =
  | { kind: "read"; read: boolean }
  | { kind: "star"; starred: boolean }
  | { kind: "move"; folderId: string }
  | { kind: "delete"; permanent: boolean };

/** One proxied message image, ready to inline as a data: URL. */
export interface ImageResult {
  contentType: string;
  bytes?: number;
  cached?: boolean;
  dataBase64: string;
}

export interface ComposeBody {
  to: string;
  subject: string;
  /** Plain text; converted to the composer's canonical HTML before sending. */
  body: string;
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
    return record.result as T;
  }

  // ── mailbox-scoped tools ─────────────────────────────────────────────

  async listEmails(
    mailboxId: string | null,
    folder = "inbox",
    options: { page?: number; limit?: number; category?: string } = {},
  ): Promise<EmailSummary[]> {
    const args: Record<string, unknown> = {
      folder,
      page: options.page ?? 1,
      limit: options.limit ?? 25,
    };
    if (options.category) args.category = options.category;
    return this.call<EmailSummary[]>("list_emails", this.mailboxBody(mailboxId, args));
  }

  async getEmail(mailboxId: string | null, emailId: string): Promise<EmailFull> {
    return this.call<EmailFull>("get_email", this.mailboxBody(mailboxId, { emailId }));
  }

  async getThread(mailboxId: string | null, threadId: string): Promise<ThreadResult> {
    return this.call<ThreadResult>("get_thread", this.mailboxBody(mailboxId, { threadId }));
  }

  async searchEmails(mailboxId: string | null, filters: SearchFilters): Promise<EmailSummary[]> {
    return this.call<EmailSummary[]>("search_emails", this.mailboxBody(mailboxId, cleanFilters(filters)));
  }

  async getAttachment(mailboxId: string | null, attachmentId: string): Promise<AttachmentResult> {
    return this.call<AttachmentResult>("get_attachment", this.mailboxBody(mailboxId, { attachmentId }));
  }

  /**
   * One remote image of a message, relayed through the deployment's SSRF
   * guard and cache and answered as base64 (read scope). The app inlines
   * the bytes as a data: URL; the sender never sees the device.
   */
  async getImage(mailboxId: string | null, url: string): Promise<ImageResult> {
    return this.call<ImageResult>("get_image", this.mailboxBody(mailboxId, { url }));
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
    return this.call<ManageResult>("delete_email", this.mailboxBody(mailboxId, { emailId, permanent }));
  }

  async snoozeEmail(mailboxId: string | null, emailId: string, until: string): Promise<ManageResult> {
    return this.call<ManageResult>("snooze_email", this.mailboxBody(mailboxId, { emailId, until }));
  }

  async unsnoozeEmail(mailboxId: string | null, emailId: string): Promise<ManageResult> {
    return this.call<ManageResult>("unsnooze_email", this.mailboxBody(mailboxId, { emailId }));
  }

  async setSenderPolicy(mailboxId: string | null, emailId: string, policy: "allow" | "block"): Promise<ManageResult> {
    return this.call<ManageResult>("set_sender_policy", this.mailboxBody(mailboxId, { emailId, policy }));
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
    input: { to: string; cc?: string; bcc?: string; subject: string; body: string },
  ): Promise<SendResult> {
    const args: Record<string, unknown> = {
      to: input.to,
      subject: input.subject,
      bodyHtml: plainTextToHtml(input.body),
    };
    if (input.cc) args.cc = input.cc;
    if (input.bcc) args.bcc = input.bcc;
    return this.call<SendResult>("send_email", this.mailboxBody(mailboxId, args));
  }

  // ── label tools ──────────────────────────────────────────────────────

  async listLabels(mailboxId: string | null): Promise<LabelListResult> {
    return this.call<LabelListResult>("list_labels", this.mailboxBody(mailboxId, {}));
  }

  async createLabel(mailboxId: string | null, input: { name: string; color?: string }): Promise<Label> {
    const args: Record<string, unknown> = { name: input.name };
    if (input.color) args.color = input.color;
    return this.call<Label>("create_label", this.mailboxBody(mailboxId, args));
  }

  async updateLabel(
    mailboxId: string | null,
    input: { label: string; name?: string; color?: string },
  ): Promise<Label> {
    const args: Record<string, unknown> = { label: input.label };
    if (input.name !== undefined) args.name = input.name;
    if (input.color !== undefined) args.color = input.color;
    return this.call<Label>("update_label", this.mailboxBody(mailboxId, args));
  }

  async deleteLabel(mailboxId: string | null, label: string): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("delete_label", this.mailboxBody(mailboxId, { label }));
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
  ): Promise<TemplateRow> {
    const args: Record<string, unknown> = { name: input.name, body: input.body };
    if (input.subject) args.subject = input.subject;
    return this.call<TemplateRow>("create_template", this.mailboxBody(mailboxId, args));
  }

  async updateTemplate(
    mailboxId: string | null,
    input: { templateId: string; name?: string; subject?: string; body?: string },
  ): Promise<TemplateRow> {
    const args: Record<string, unknown> = { templateId: input.templateId };
    if (input.name !== undefined) args.name = input.name;
    if (input.subject !== undefined) args.subject = input.subject;
    if (input.body !== undefined) args.body = input.body;
    return this.call<TemplateRow>("update_template", this.mailboxBody(mailboxId, args));
  }

  async deleteTemplate(mailboxId: string | null, templateId: string): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("delete_template", this.mailboxBody(mailboxId, { templateId }));
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
  ): Promise<SavedSearchRow> {
    return this.call<SavedSearchRow>(
      "create_saved_search",
      this.mailboxBody(mailboxId, { name: input.name, query: input.query }),
    );
  }

  async updateSavedSearch(
    mailboxId: string | null,
    input: { searchId: string; name?: string; query?: string },
  ): Promise<SavedSearchRow> {
    const args: Record<string, unknown> = { searchId: input.searchId };
    if (input.name !== undefined) args.name = input.name;
    if (input.query !== undefined) args.query = input.query;
    return this.call<SavedSearchRow>("update_saved_search", this.mailboxBody(mailboxId, args));
  }

  async deleteSavedSearch(mailboxId: string | null, searchId: string): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("delete_saved_search", this.mailboxBody(mailboxId, { searchId }));
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

  async emptyTrash(mailboxId: string | null): Promise<{ purged: number }> {
    return this.call<{ purged: number }>("empty_trash", this.mailboxBody(mailboxId, {}));
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
  ): Promise<ScheduledSend> {
    const args: Record<string, unknown> = {
      to: input.to,
      subject: input.subject,
      bodyHtml: plainTextToHtml(input.body),
      sendAt: input.sendAt,
    };
    if (input.cc) args.cc = input.cc;
    if (input.bcc) args.bcc = input.bcc;
    return this.call<ScheduledSend>("schedule_send", this.mailboxBody(mailboxId, args));
  }

  async cancelScheduledSend(
    mailboxId: string | null,
    scheduledSendId: string,
  ): Promise<ScheduledSendActionResult> {
    return this.call<ScheduledSendActionResult>(
      "cancel_scheduled_send",
      this.mailboxBody(mailboxId, { scheduledSendId }),
    );
  }

  async retryScheduledSend(
    mailboxId: string | null,
    scheduledSendId: string,
  ): Promise<ScheduledSendActionResult> {
    return this.call<ScheduledSendActionResult>(
      "retry_scheduled_send",
      this.mailboxBody(mailboxId, { scheduledSendId }),
    );
  }

  // ── app-only tools (global key) ──────────────────────────────────────

  async listMailboxes(): Promise<Mailbox[]> {
    this.assertAppKey("list_mailboxes");
    return this.call<Mailbox[]>("list_mailboxes", {});
  }

  async searchAllMailboxes(filters: SearchFilters): Promise<EmailSummary[]> {
    this.assertAppKey("search_all_mailboxes");
    return this.call<EmailSummary[]>("search_all_mailboxes", cleanFilters(filters));
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
