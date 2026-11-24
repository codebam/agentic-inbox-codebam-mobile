/**
 * The Mailflare JMAP client behind every screen.
 *
 * The app used to call mailflare-codebam's `/api/v1/scoped/<tool>` facade,
 * which only exists in the fork. This client speaks JMAP (RFC 8620/8621) to
 * the server's `/jmap` endpoint instead, so it works against stock Mailflare:
 *
 *   GET  /.well-known/jmap   discovery -> the Session resource
 *   POST {apiUrl}            batched method calls (Email/query, Email/set...)
 *
 * Mailflare exposes one JMAP account per key (the key's user) and models its
 * mailboxes as top-level JMAP mailboxes with system/user folders as children;
 * `encodeMailboxId`/`decodeMailboxId` in ./jmap pin that encoding down.
 *
 * The exported names and shapes are unchanged from the facade era so the
 * screens and react-query hooks keep working. Features the fork added and the
 * server does not implement over JMAP (labels, templates, saved searches,
 * muted threads, sender policy, unsubscribe, snooze, scheduled sends, thread
 * summaries) throw a clear `ApiError` with status 501 instead of pretending.
 */

import { plainTextToHtml } from "./email-html";
import {
  decodeMailboxId,
  encodeMailboxId,
  JmapClient,
  JmapError,
  normalizeServerUrl,
  type SystemRole,
} from "./jmap";
import { parseToken, type TokenKind } from "./token";

export const DEFAULT_SERVER_URL = "https://email.codebam.ca";

export interface Session {
  baseUrl: string;
  token: string;
  kind: TokenKind;
  /** Always null now: one key reaches every mailbox the user can read. */
  mailboxId: string | null;
}

/** Normalize a server URL: trim, drop trailing slashes, default the scheme to https. */
export function normalizeBaseUrl(raw: string): string {
  try {
    return normalizeServerUrl(raw);
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

/** Build a session from a pasted key, or null when the key is not one of ours. */
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

function cleanFilters(filters: SearchFilters): SearchFilters {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out as SearchFilters;
}

// ── JMAP shapes ─────────────────────────────────────────────────────────

interface JmapAddress {
  name?: string | null;
  email?: string | null;
}

interface JmapPart {
  partId?: string;
  blobId?: string;
  size?: number;
  type?: string;
  name?: string | null;
  disposition?: string | null;
}

interface JmapEmail {
  id: string;
  threadId?: string | null;
  mailboxIds?: Record<string, boolean>;
  keywords?: Record<string, boolean>;
  size?: number;
  subject?: string | null;
  sender?: JmapAddress[] | null;
  from?: JmapAddress[] | null;
  to?: JmapAddress[] | null;
  cc?: JmapAddress[] | null;
  bcc?: JmapAddress[] | null;
  replyTo?: JmapAddress[] | null;
  preview?: string | null;
  receivedAt?: string | null;
  sentAt?: string | null;
  messageId?: string[] | null;
  inReplyTo?: string[] | null;
  references?: string[] | null;
  hasAttachment?: boolean;
  textBody?: JmapPart[] | null;
  htmlBody?: JmapPart[] | null;
  bodyValues?: Record<string, { value?: string | null }> | null;
  attachments?: JmapPart[] | null;
}

interface JmapMailbox {
  id: string;
  name?: string | null;
  parentId?: string | null;
  role?: string | null;
}

const SUMMARY_PROPERTIES = [
  "id", "threadId", "mailboxIds", "keywords", "size", "subject", "sender", "from", "to",
  "preview", "receivedAt", "sentAt", "hasAttachment",
];

const FULL_PROPERTIES = [
  ...SUMMARY_PROPERTIES, "cc", "bcc", "replyTo", "messageId", "inReplyTo", "references",
  "textBody", "htmlBody", "bodyValues", "attachments",
];

/** The most objects one Email/set may carry (the server's maxObjectsInSet). */
const SET_BATCH = 100;

function formatAddress(address: JmapAddress | undefined): string {
  if (!address) return "";
  const email = typeof address.email === "string" ? address.email : "";
  const name = typeof address.name === "string" ? address.name.trim() : "";
  if (!email) return name;
  return name ? `${name} <${email}>` : email;
}

function formatAddressList(list: JmapAddress[] | null | undefined): string {
  return Array.isArray(list) ? list.map((item) => formatAddress(item)).filter(Boolean).join(", ") : "";
}

/** Parse a comma-separated address header into JMAP address objects. */
function parseAddressList(value: string | null | undefined): JmapAddress[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*?)\s*<([^>]+)>$/.exec(part);
      if (match) return { name: match[1]?.trim() ?? "", email: (match[2] ?? "").trim() };
      return { email: part };
    });
}

function roleToStatus(role: SystemRole | null): string {
  switch (role) {
    case "sent": return "sent";
    case "drafts": return "draft";
    case "archive": return "archived";
    case "junk": return "spam";
    case "trash": return "trash";
    default: return "received";
  }
}

function unwrap<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    if (error instanceof JmapError) throw new ApiError(error.message, error.isAuthError ? 401 : error.status || 0);
    throw error;
  });
}

export class ScopedApi {
  private readonly jmap: JmapClient;
  private mailboxesPromise: Promise<JmapMailbox[]> | null = null;

  constructor(readonly session: Session) {
    this.jmap = new JmapClient(session.baseUrl, session.token);
  }

  get host(): string {
    return this.jmap.host;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    return unwrap(operation());
  }

  /** Every JMAP mailbox (address mailboxes and their folder children), cached. */
  private mailboxes(): Promise<JmapMailbox[]> {
    if (!this.mailboxesPromise) {
      this.mailboxesPromise = (async () => {
        const session = await this.jmap.session();
        const response = await this.jmap.call([
          ["Mailbox/get", { accountId: session.accountId, ids: null }, "m"],
        ]);
        const result = JmapClient.result(response, "m");
        return Array.isArray(result.list) ? (result.list as JmapMailbox[]) : [];
      })().catch((error: unknown) => {
        this.mailboxesPromise = null;
        throw error;
      });
    }
    return this.mailboxesPromise;
  }

  /** The address-level mailboxes: one per Mailflare mailbox, parentId null. */
  async listMailboxes(): Promise<Mailbox[]> {
    return this.run(async () => {
      const mailboxes = await this.mailboxes();
      return mailboxes
        .filter((mailbox) => !mailbox.parentId)
        .map((mailbox) => {
          const name = typeof mailbox.name === "string" ? mailbox.name : "";
          const match = /^(.*?)\s*<([^>]+)>$/.exec(name);
          if (match) return { id: mailbox.id, address: (match[2] ?? "").trim(), displayName: (match[1] ?? "").trim() || null };
          return { id: mailbox.id, address: name, displayName: null };
        })
        .sort((a, b) => a.address.localeCompare(b.address));
    });
  }

  private requireMailbox(mailboxId: string | null): string {
    if (!mailboxId) throw new ApiError("Choose a mailbox first.", 400);
    return mailboxId;
  }

  private async identityFor(mailboxId: string): Promise<{ id: string; email: string; name: string }> {
    const session = await this.jmap.session();
    const response = await this.jmap.call([["Identity/get", { accountId: session.accountId, ids: null }, "i"]]);
    const result = JmapClient.result(response, "i");
    const list = Array.isArray(result.list) ? (result.list as Record<string, unknown>[]) : [];
    const match = list.find((item) => typeof item.id === "string" && item.id.startsWith(`${mailboxId}~`));
    const email = match && typeof match.email === "string" ? match.email : "";
    if (!match || !email) throw new ApiError("This mailbox has no sendable address.", 403);
    return { id: String(match.id), email, name: typeof match.name === "string" ? match.name : "" };
  }

  /** One Email/query + Email/get round trip. */
  private async queryPage(
    filter: Record<string, unknown>,
    position: number,
    limit: number,
  ): Promise<{ emails: JmapEmail[]; total: number }> {
    const session = await this.jmap.session();
    const response = await this.jmap.call([
      ["Email/query", {
        accountId: session.accountId,
        filter,
        sort: [{ property: "receivedAt", isAscending: false }],
        position,
        limit,
        calculateTotal: true,
      }, "q"],
      ["Email/get", {
        accountId: session.accountId,
        "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
        properties: SUMMARY_PROPERTIES,
      }, "g"],
    ]);
    const query = JmapClient.result(response, "q");
    const list = JmapClient.result(response, "g");
    return {
      emails: Array.isArray(list.list) ? (list.list as JmapEmail[]) : [],
      total: typeof query.total === "number" ? query.total : 0,
    };
  }

  /** Query one filter, or merge the same folder across every mailbox. */
  private async queryMerged(
    filters: Record<string, unknown>[],
    page: number,
    limit: number,
  ): Promise<EmailsResult> {
    const start = (page - 1) * limit;
    if (filters.length === 1) {
      const { emails, total } = await this.queryPage(filters[0] ?? {}, start, limit);
      return { emails: emails.map(toSummary), totalCount: total, page, limit };
    }
    // One query per mailbox, all fetched up to this page's end, then merged.
    const pages = await Promise.all(filters.map((filter) => this.queryPage(filter, 0, page * limit)));
    const merged = pages
      .flatMap((result) => result.emails)
      .sort((a, b) => sortableDate(b).localeCompare(sortableDate(a)))
      .slice(start, start + limit);
    return {
      emails: merged.map(toSummary),
      totalCount: pages.reduce((total, result) => total + result.total, 0),
      page,
      limit,
    };
  }

  /** The filters for "this folder in every mailbox", or the whole account. */
  private async folderFilters(folder: string | null | undefined, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    if (!folder || folder === "all") return [{ ...extra }];
    const mailboxes = await this.listMailboxes();
    return mailboxes.map((mailbox) => ({ ...extra, inMailbox: encodeMailboxId(mailbox.id, folder) }));
  }

  // ── mail ─────────────────────────────────────────────────────────────

  async listEmails(
    mailboxId: string | null,
    folder = "inbox",
    options: { page?: number; limit?: number; category?: string } = {},
  ): Promise<EmailsResult> {
    const mailbox = this.requireMailbox(mailboxId);
    const page = options.page ?? 1;
    const limit = options.limit ?? 25;
    return this.run(() =>
      this.queryMerged([{ inMailbox: encodeMailboxId(mailbox, folder) }], page, limit),
    );
  }

  async getEmail(mailboxId: string | null, emailId: string): Promise<EmailFull> {
    this.requireMailbox(mailboxId);
    return this.run(async () => {
      const session = await this.jmap.session();
      const response = await this.jmap.call([
        ["Email/get", {
          accountId: session.accountId,
          ids: [emailId],
          properties: FULL_PROPERTIES,
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
        }, "e"],
      ]);
      const result = JmapClient.result(response, "e");
      const list = Array.isArray(result.list) ? (result.list as JmapEmail[]) : [];
      const email = list[0];
      if (!email) throw new ApiError("That message was not found.", 404);
      return toFull(email);
    });
  }

  async getThread(mailboxId: string | null, threadId: string): Promise<ThreadResult> {
    this.requireMailbox(mailboxId);
    return this.run(async () => {
      const session = await this.jmap.session();
      const thread = JmapClient.result(
        await this.jmap.call([["Thread/get", { accountId: session.accountId, ids: [threadId] }, "t"]]),
        "t",
      );
      const threads = Array.isArray(thread.list) ? (thread.list as { id: string; emailIds?: string[] }[]) : [];
      const emailIds = threads[0]?.emailIds ?? [];
      if (!emailIds.length) return { thread_id: threadId, emails: [] };
      const emails = JmapClient.result(
        await this.jmap.call([
          ["Email/get", {
            accountId: session.accountId,
            ids: emailIds,
            properties: FULL_PROPERTIES,
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
          }, "e"],
        ]),
        "e",
      );
      const list = Array.isArray(emails.list) ? (emails.list as JmapEmail[]) : [];
      return {
        thread_id: threadId,
        emails: list
          .map(toFull)
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
  }

  async searchEmails(mailboxId: string | null, filters: SearchFilters): Promise<EmailsResult> {
    const mailbox = this.requireMailbox(mailboxId);
    const clean = cleanFilters(filters);
    const page = clean.page ?? 1;
    const limit = clean.limit ?? 25;
    return this.run(async () => {
      const filter = searchFilter(clean);
      if (clean.folder) filter.inMailbox = encodeMailboxId(mailbox, clean.folder);
      return this.queryMerged([filter], page, limit);
    });
  }

  async getAttachment(mailboxId: string | null, attachmentId: string): Promise<AttachmentResult> {
    this.requireMailbox(mailboxId);
    return this.run(async () => {
      const response = await this.jmap.openDownload(attachmentId);
      const type = response.headers.get("content-type") ?? "application/octet-stream";
      const textual = /^text\/|json|xml|csv/i.test(type);
      const content = textual ? await response.text() : null;
      return {
        id: attachmentId,
        messageId: "",
        filename: downloadName(response) ?? "attachment",
        mimetype: type,
        size: Number(response.headers.get("content-length") ?? 0) || content?.length || 0,
        content,
        ...(textual ? {} : { omitted: "Binary attachment — open it in the Mailflare web app." }),
      };
    });
  }

  // ── manage ───────────────────────────────────────────────────────────

  private async updateEmail(emailId: string, patch: Record<string, unknown>): Promise<ManageResult> {
    const session = await this.jmap.session();
    const response = await this.jmap.call([
      ["Email/set", { accountId: session.accountId, update: { [emailId]: patch } }, "s"],
    ]);
    const result = JmapClient.result(response, "s");
    const notUpdated = result.notUpdated as Record<string, { description?: string }> | undefined;
    if (notUpdated?.[emailId]) throw new ApiError(notUpdated[emailId]?.description ?? "The server refused that change.", 400);
    return { status: "updated", emailId };
  }

  async markEmailRead(mailboxId: string | null, emailId: string, read: boolean): Promise<ManageResult> {
    this.requireMailbox(mailboxId);
    return this.run(() => this.updateEmail(emailId, { keywords: { $seen: read } }));
  }

  async starEmail(mailboxId: string | null, emailId: string, starred: boolean): Promise<ManageResult> {
    this.requireMailbox(mailboxId);
    return this.run(() => this.updateEmail(emailId, { keywords: { $flagged: starred } }));
  }

  async moveEmail(mailboxId: string | null, emailId: string, folderId: string): Promise<ManageResult> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(() => this.updateEmail(emailId, { mailboxIds: { [encodeMailboxId(mailbox, folderId)]: true } }));
  }

  async deleteEmail(mailboxId: string | null, emailId: string, permanent = false): Promise<ManageResult> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(async () => {
      if (!permanent) {
        await this.updateEmail(emailId, { mailboxIds: { [encodeMailboxId(mailbox, "trash")]: true } });
        return { status: "trashed", emailId };
      }
      const session = await this.jmap.session();
      const response = await this.jmap.call([
        ["Email/set", { accountId: session.accountId, destroy: [emailId] }, "d"],
      ]);
      const result = JmapClient.result(response, "d");
      const notDestroyed = result.notDestroyed as Record<string, { description?: string }> | undefined;
      if (notDestroyed?.[emailId]) throw new ApiError(notDestroyed[emailId]?.description ?? "The server refused the delete.", 400);
      return { status: "deleted", emailId };
    });
  }

  async restoreEmail(mailboxId: string | null, emailId: string): Promise<ManageResult> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(() => this.updateEmail(emailId, { mailboxIds: { [encodeMailboxId(mailbox, "inbox")]: true } }));
  }

  async emptyTrash(mailboxId: string | null): Promise<{ deleted: number }> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(async () => {
      const session = await this.jmap.session();
      let deleted = 0;
      for (;;) {
        const { emails } = await this.queryPage({ inMailbox: encodeMailboxId(mailbox, "trash") }, 0, SET_BATCH);
        if (!emails.length) break;
        const ids = emails.slice(0, SET_BATCH).map((email) => email.id);
        const response = await this.jmap.call([
          ["Email/set", { accountId: session.accountId, destroy: ids }, "d"],
        ]);
        const result = JmapClient.result(response, "d");
        const destroyed = Array.isArray(result.destroyed) ? (result.destroyed as string[]) : [];
        deleted += destroyed.length;
        if (destroyed.length < ids.length) break;
      }
      return { deleted };
    });
  }

  async markThreadRead(mailboxId: string | null, threadId: string): Promise<ManageResult> {
    this.requireMailbox(mailboxId);
    return this.run(async () => {
      const session = await this.jmap.session();
      const thread = JmapClient.result(
        await this.jmap.call([["Thread/get", { accountId: session.accountId, ids: [threadId] }, "t"]]),
        "t",
      );
      const emailIds = Array.isArray(thread.list) && thread.list[0]?.emailIds ? (thread.list[0].emailIds as string[]) : [];
      if (emailIds.length) {
        const update: Record<string, unknown> = {};
        for (const id of emailIds) update[id] = { keywords: { $seen: true } };
        await this.jmap.call([["Email/set", { accountId: session.accountId, update }, "s"]]);
      }
      return { status: "updated", threadId };
    });
  }

  // ── drafts and sending ───────────────────────────────────────────────

  private async draftBody(
    mailboxId: string,
    input: { to: string; cc?: string; bcc?: string; subject: string; body: string; inReplyTo?: string | null; references?: string[] },
  ): Promise<Record<string, unknown>> {
    const identity = await this.identityFor(mailboxId);
    const html = plainTextToHtml(input.body);
    return {
      mailboxIds: { [encodeMailboxId(mailboxId, "drafts")]: true },
      keywords: { $draft: true, $seen: true },
      from: [{ email: identity.email, ...(identity.name ? { name: identity.name } : {}) }],
      to: parseAddressList(input.to),
      ...(input.cc ? { cc: parseAddressList(input.cc) } : {}),
      ...(input.bcc ? { bcc: parseAddressList(input.bcc) } : {}),
      subject: input.subject,
      bodyValues: { t: { value: input.body }, h: { value: html } },
      textBody: [{ partId: "t", type: "text/plain" }],
      htmlBody: [{ partId: "h", type: "text/html" }],
      ...(input.inReplyTo ? { inReplyTo: [input.inReplyTo] } : {}),
      ...(input.references?.length ? { references: input.references } : {}),
    };
  }

  async createDraft(
    mailboxId: string | null,
    input: { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string },
  ): Promise<DraftSavedResult> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(async () => {
      const session = await this.jmap.session();
      const create = await this.draftBody(mailbox, { ...input, inReplyTo: input.inReplyTo ?? null });
      const response = await this.jmap.call([
        ["Email/set", { accountId: session.accountId, create: { draft: create } }, "c"],
      ]);
      const result = JmapClient.result(response, "c");
      const created = result.created as Record<string, { id?: string }> | undefined;
      const id = created?.draft?.id;
      if (!id) throw new ApiError(createError(result.notCreated, "draft") ?? "The server did not save the draft.", 400);
      return { draftId: id, status: "draft" };
    });
  }

  async draftReply(
    mailboxId: string | null,
    input: { originalEmailId: string; to?: string; subject: string; body: string },
  ): Promise<DraftSavedResult> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(async () => {
      const original = await this.getEmail(mailbox, input.originalEmailId);
      return this.createDraft(mailbox, {
        to: input.to ?? original.sender ?? "",
        subject: input.subject,
        body: input.body,
        inReplyTo: original.message_id ?? undefined,
        threadId: original.thread_id ?? undefined,
      });
    });
  }

  async updateDraft(
    mailboxId: string | null,
    input: { draftId: string; to?: string; subject?: string; body?: string },
  ): Promise<DraftUpdatedResult> {
    this.requireMailbox(mailboxId);
    return this.run(async () => {
      const patch: Record<string, unknown> = {};
      if (input.to !== undefined && input.to.trim()) patch.to = parseAddressList(input.to);
      if (input.subject !== undefined && input.subject.trim()) patch.subject = input.subject.trim();
      if (input.body !== undefined && input.body.trim()) {
        const html = plainTextToHtml(input.body);
        patch.bodyValues = { t: { value: input.body }, h: { value: html } };
        patch.textBody = [{ partId: "t", type: "text/plain" }];
        patch.htmlBody = [{ partId: "h", type: "text/html" }];
      }
      await this.updateEmail(input.draftId, patch);
      return { draftId: input.draftId, status: "draft" };
    });
  }

  async discardDraft(mailboxId: string | null, draftId: string): Promise<DiscardedResult> {
    this.requireMailbox(mailboxId);
    return this.run(async () => {
      await this.deleteEmail(mailboxId, draftId, true);
      return { deleted: true };
    });
  }

  private async submit(mailboxId: string, create: Record<string, unknown>): Promise<SendResult> {
    const session = await this.jmap.session();
    const identity = await this.identityFor(mailboxId);
    const response = await this.jmap.call([
      ["Email/set", { accountId: session.accountId, create: { draft: create } }, "c"],
      ["EmailSubmission/set", { accountId: session.accountId, create: { send: { identityId: identity.id, emailId: "#draft" } } }, "s"],
    ]);
    const setResult = JmapClient.result(response, "c", "Email/set");
    const created = setResult.created as Record<string, { id?: string }> | undefined;
    if (!created?.draft?.id) throw new ApiError(createError(setResult.notCreated, "draft") ?? "The server did not save the message.", 400);
    const submitResult = JmapClient.result(response, "s", "EmailSubmission/set");
    const submitted = submitResult.created as Record<string, { id?: string }> | undefined;
    if (!submitted?.send?.id) throw new ApiError(createError(submitResult.notCreated, "send") ?? "The server refused to send.", 400);
    return { messageId: submitted.send.id, status: "sent" };
  }

  async sendEmail(
    mailboxId: string | null,
    input: { to: string; cc?: string; bcc?: string; subject: string; body: string; attachments?: OutboundAttachment[] },
  ): Promise<SendResult> {
    const mailbox = this.requireMailbox(mailboxId);
    if (input.attachments?.length) throw new ApiError("Attachments are not supported by this build yet.", 501);
    return this.run(async () => this.submit(mailbox, await this.draftBody(mailbox, input)));
  }

  async sendReply(
    mailboxId: string | null,
    input: { originalEmailId: string; to: string; subject: string; body: string },
  ): Promise<SendResult> {
    const mailbox = this.requireMailbox(mailboxId);
    return this.run(async () => {
      const original = await this.getEmail(mailbox, input.originalEmailId);
      return this.submit(
        mailbox,
        await this.draftBody(mailbox, {
          to: input.to,
          subject: input.subject,
          body: input.body,
          inReplyTo: original.message_id ?? null,
        }),
      );
    });
  }

  // ── account-wide listings ────────────────────────────────────────────

  async listAllEmails(
    folder: string | null,
    options: { page?: number; limit?: number } = {},
  ): Promise<EmailsResult> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 25;
    return this.run(async () => this.queryMerged(await this.folderFilters(folder), page, limit));
  }

  async searchAllMailboxes(filters: SearchFilters): Promise<EmailsResult> {
    const clean = cleanFilters(filters);
    const page = clean.page ?? 1;
    const limit = clean.limit ?? 25;
    return this.run(async () => {
      const extra = searchFilter(clean);
      return this.queryMerged(await this.folderFilters(clean.folder, extra), page, limit);
    });
  }

  // ── features only the fork's REST facade had ─────────────────────────

  private unsupported(feature: string): never {
    throw new ApiError(`${feature} is not available over JMAP on this server.`, 501);
  }

  async snoozeEmail(..._args: unknown[]): Promise<ManageResult> { return this.unsupported("Snoozing"); }
  async unsnoozeEmail(..._args: unknown[]): Promise<ManageResult> { return this.unsupported("Unsnoozing"); }
  async setSenderPolicy(..._args: unknown[]): Promise<ManageResult> { return this.unsupported("Sender policy"); }
  async unsubscribeEmail(..._args: unknown[]): Promise<ManageResult> { return this.unsupported("Unsubscribe"); }
  async muteThread(..._args: unknown[]): Promise<{ muted: boolean }> { return this.unsupported("Muting a thread"); }
  async unmuteThread(..._args: unknown[]): Promise<{ muted: boolean }> { return this.unsupported("Unmuting a thread"); }
  async summarizeThread(..._args: unknown[]): Promise<ThreadSummary> { return this.unsupported("Thread summaries"); }
  async listLabels(..._args: unknown[]): Promise<LabelListResult> { return this.unsupported("Labels"); }
  async createLabel(..._args: unknown[]): Promise<{ label: Label }> { return this.unsupported("Labels"); }
  async updateLabel(..._args: unknown[]): Promise<{ label: Label }> { return this.unsupported("Labels"); }
  async deleteLabel(..._args: unknown[]): Promise<{ deleted: boolean }> { return this.unsupported("Labels"); }
  async addLabel(..._args: unknown[]): Promise<LabelUpdateResult> { return this.unsupported("Labels"); }
  async removeLabel(..._args: unknown[]): Promise<LabelUpdateResult> { return this.unsupported("Labels"); }
  async listTemplates(..._args: unknown[]): Promise<TemplateListResult> { return this.unsupported("Templates"); }
  async createTemplate(..._args: unknown[]): Promise<{ template: TemplateRow }> { return this.unsupported("Templates"); }
  async updateTemplate(..._args: unknown[]): Promise<{ template: TemplateRow }> { return this.unsupported("Templates"); }
  async deleteTemplate(..._args: unknown[]): Promise<{ deleted: boolean }> { return this.unsupported("Templates"); }
  async listSavedSearches(..._args: unknown[]): Promise<{ searches: SavedSearchRow[] }> { return this.unsupported("Saved searches"); }
  async createSavedSearch(..._args: unknown[]): Promise<{ search: SavedSearchRow }> { return this.unsupported("Saved searches"); }
  async updateSavedSearch(..._args: unknown[]): Promise<{ search: SavedSearchRow }> { return this.unsupported("Saved searches"); }
  async deleteSavedSearch(..._args: unknown[]): Promise<{ deleted: boolean }> { return this.unsupported("Saved searches"); }
  async listScheduledSends(..._args: unknown[]): Promise<ScheduledSendListResult> { return this.unsupported("Scheduled sends"); }
  async scheduleSend(..._args: unknown[]): Promise<{ id: string; status: string; sendAt: string }> { return this.unsupported("Scheduled sends"); }
  async retryScheduledSend(..._args: unknown[]): Promise<{ id: string; status: string }> { return this.unsupported("Scheduled sends"); }
}

function createError(notCreated: unknown, key: string): string | null {
  if (!notCreated || typeof notCreated !== "object") return null;
  const entry = (notCreated as Record<string, { description?: string; type?: string }>)[key];
  if (!entry) return null;
  return entry.description ?? (entry.type ? `The server refused it (${entry.type}).` : null);
}

function sortableDate(email: JmapEmail): string {
  return email.receivedAt ?? email.sentAt ?? "";
}

function toSummary(email: JmapEmail): EmailSummary {
  const mailboxIds = Object.keys(email.mailboxIds ?? {});
  const first = mailboxIds[0] ?? "";
  const ref = first ? decodeMailboxId(first) : null;
  const keywords = email.keywords ?? {};
  return {
    id: email.id,
    subject: email.subject ?? null,
    sender: formatAddress(email.from?.[0]) || formatAddress(email.sender?.[0]) || null,
    recipient: formatAddress(email.to?.[0]) || null,
    date: sortableDate(email),
    read: keywords.$seen === true,
    starred: keywords.$flagged === true,
    thread_id: email.threadId ?? null,
    category: null,
    folder_id: ref?.folderId ?? null,
    status: ref?.role ? roleToStatus(ref.role) : "received",
    snippet: email.preview ?? null,
  };
}

function bodyValue(email: JmapEmail, parts: JmapPart[] | null | undefined): string | null {
  const part = parts?.[0];
  if (!part?.partId) return null;
  const value = email.bodyValues?.[part.partId]?.value;
  return typeof value === "string" ? value : null;
}

function toFull(email: JmapEmail): EmailFull {
  const summary = toSummary(email);
  const mailboxId = Object.keys(email.mailboxIds ?? {})[0] ?? "";
  const ref = mailboxId ? decodeMailboxId(mailboxId) : null;
  return {
    ...summary,
    ...(ref ? { mailbox_id: ref.mailboxId } : {}),
    cc: formatAddressList(email.cc) || null,
    bcc: formatAddressList(email.bcc) || null,
    reply_to: formatAddressList(email.replyTo) || null,
    message_id: email.messageId?.[0] ?? null,
    in_reply_to: email.inReplyTo?.[0] ?? null,
    bodyText: bodyValue(email, email.textBody),
    bodyHtml: bodyValue(email, email.htmlBody),
    attachments: (email.attachments ?? [])
      .filter((part) => part.blobId)
      .map((part) => ({
        id: String(part.blobId),
        filename: part.name ?? "attachment",
        mimetype: part.type ?? "application/octet-stream",
        size: part.size ?? 0,
      })),
  };
}

/** The JMAP filter for a set of search filters. */
function searchFilter(filters: SearchFilters): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (filters.query) filter.text = filters.query;
  if (filters.from) filter.from = filters.from;
  if (filters.to) filter.to = filters.to;
  if (filters.subject) filter.subject = filters.subject;
  if (filters.hasAttachment) filter.hasAttachment = true;
  if (filters.before) filter.before = new Date(filters.before).toISOString();
  if (filters.after) filter.after = new Date(filters.after).toISOString();
  if (filters.isRead === true) filter.hasKeyword = "$seen";
  else if (filters.isRead === false) filter.notKeyword = "$seen";
  if (filters.isStarred === true) filter.hasKeyword = "$flagged";
  else if (filters.isStarred === false) filter.notKeyword = "$flagged";
  return filter;
}

function downloadName(response: Response): string | null {
  const disposition = response.headers.get("content-disposition");
  if (!disposition) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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
