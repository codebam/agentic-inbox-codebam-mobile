/**
 * A small JMAP (RFC 8620/8621) client for Mailflare's `/jmap` endpoint.
 *
 * The server exposes one JMAP account per API key (the key's user) and models
 * its own mailboxes as top-level JMAP mailboxes, with the system folders and
 * user folders as children (see `src/lib/jmap/ids.ts` in mailflare):
 *
 *   mbx_123             the whole address (all mail for that mailbox)
 *   mbx_123~inbox       one system folder (inbox/sent/drafts/archive/junk/trash)
 *   mbx_123~f~fold_9    one user folder
 *
 * Nothing here is Mailflare-specific beyond that id encoding: discovery,
 * batching and the request envelope are plain JMAP.
 */

const CAPABILITY_CORE = "urn:ietf:params:jmap:core";
const CAPABILITY_MAIL = "urn:ietf:params:jmap:mail";
const CAPABILITY_SUBMISSION = "urn:ietf:params:jmap:submission";

const REQUEST_TIMEOUT_MS = 30_000;

/** One method call, in the order it should run. */
export type JmapCall = [name: string, args: Record<string, unknown>, callId: string];

/** The session resource (RFC 8620 §2). Only the parts this client reads. */
export interface JmapSession {
  username: string;
  accountId: string;
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
}

/** An error from the server (HTTP status or a JMAP method-level error). */
export class JmapError extends Error {
  readonly status: number;
  readonly type: string | null;

  constructor(message: string, status: number, type: string | null = null) {
    super(message);
    this.name = "JmapError";
    this.status = status;
    this.type = type;
  }

  /** True when the key itself was rejected (revoked or invalid). */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface JmapResponse {
  /**
   * Responses keyed by call id. A call id can answer more than once: an
   * EmailSubmission/set is followed by the Email/set that destroys the draft,
   * both carrying the submission's call id.
   */
  responses: Map<string, { name: string; args: Record<string, unknown> }[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Normalize a server URL: trim, drop trailing slashes, default the scheme to https. */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new JmapError("Enter the server URL.", 0);
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export class JmapClient {
  private sessionPromise: Promise<JmapSession> | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  get host(): string {
    try {
      return new URL(this.baseUrl).host;
    } catch {
      return this.baseUrl;
    }
  }

  /** Discovery, cached for the life of the client. */
  session(): Promise<JmapSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = this.discover().catch((error: unknown) => {
        // A failed discovery must not be cached: the next call retries.
        this.sessionPromise = null;
        throw error;
      });
    }
    return this.sessionPromise;
  }

  private async discover(): Promise<JmapSession> {
    // RFC 8620 §2.2: the well-known URL redirects to the Session resource.
    const response = await this.request(`/.well-known/jmap`, { method: "GET" }, this.baseUrl);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!isRecord(payload)) {
      throw new JmapError(`${this.host} did not answer with a JMAP session.`, response.status);
    }
    const accounts = isRecord(payload.accounts) ? payload.accounts : {};
    const accountId = typeof payload.primaryAccounts === "object" && isRecord(payload.primaryAccounts)
      ? String((payload.primaryAccounts as Record<string, unknown>)[CAPABILITY_MAIL] ?? "")
      : "";
    const resolvedAccountId = accountId && isRecord(accounts[accountId]) ? accountId : Object.keys(accounts)[0] ?? "";
    if (!resolvedAccountId) {
      throw new JmapError("This key has no JMAP mail account.", response.status);
    }
    const apiUrl = typeof payload.apiUrl === "string" ? new URL(payload.apiUrl, this.baseUrl).toString() : "";
    const downloadUrl = typeof payload.downloadUrl === "string" ? new URL(payload.downloadUrl, this.baseUrl).toString() : "";
    const uploadUrl = typeof payload.uploadUrl === "string" ? new URL(payload.uploadUrl, this.baseUrl).toString() : "";
    if (!apiUrl) throw new JmapError(`${this.host} did not answer with an apiUrl.`, response.status);
    return {
      username: typeof payload.username === "string" ? payload.username : "",
      accountId: resolvedAccountId,
      apiUrl,
      downloadUrl,
      uploadUrl,
    };
  }

  private async request(path: string, init: RequestInit, base = this.baseUrl): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(path.startsWith("http") ? path : `${base}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new JmapError(
        aborted
          ? `The request to ${this.host} timed out.`
          : `Couldn't reach ${this.host}. Check the server URL and your connection.`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      throw new JmapError("This key was rejected by the server. Create a new API key with the JMAP scope.", response.status);
    }
    return response;
  }

  /** Run method calls in one request and return their responses by call id. */
  async call(calls: JmapCall[]): Promise<JmapResponse> {
    const session = await this.session();
    const response = await this.request(session.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        using: [CAPABILITY_CORE, CAPABILITY_MAIL, CAPABILITY_SUBMISSION],
        methodCalls: calls,
      }),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!isRecord(payload) || !Array.isArray(payload.methodResponses)) {
      throw new JmapError(`The server answered ${response.status} without a JMAP response.`, response.status);
    }
    const responses = new Map<string, { name: string; args: Record<string, unknown> }[]>();
    for (const item of payload.methodResponses as unknown[]) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const [name, args, callId] = item as [unknown, unknown, unknown];
      if (typeof name !== "string" || typeof callId !== "string" || !isRecord(args)) continue;
      const entries = responses.get(callId) ?? [];
      entries.push({ name, args });
      responses.set(callId, entries);
    }
    return { responses };
  }

  /**
   * The `arguments` of one call, or a thrown error when the method failed.
   * Pass `method` when a call id can be answered twice (submission + destroy).
   */
  static result(response: JmapResponse, callId: string, method?: string): Record<string, unknown> {
    const entries = response.responses.get(callId);
    if (!entries?.length) throw new JmapError("The server did not answer that request.", 200);
    const entry = (method ? entries.find((item) => item.name === method) : undefined) ?? entries[0]!;
    if (entry.name === "error") {
      const type = typeof entry.args.type === "string" ? entry.args.type : "serverFail";
      const description = typeof entry.args.description === "string" ? entry.args.description : null;
      throw new JmapError(description ?? `The server refused the request (${type}).`, 200, type);
    }
    return entry.args;
  }

  /** The download response itself, for callers that want text vs bytes. */
  async openDownload(blobId: string, name = "attachment", type = "application/octet-stream"): Promise<Response> {
    const session = await this.session();
    const url = session.downloadUrl
      .replace("{accountId}", encodeURIComponent(session.accountId))
      .replace("{blobId}", encodeURIComponent(blobId))
      .replace("{name}", encodeURIComponent(name))
      .replace("{type}", encodeURIComponent(type));
    const response = await this.request(url, { method: "GET" });
    if (!response.ok) throw new JmapError(`Download failed (${response.status}).`, response.status);
    return response;
  }

  /** Fetch a blob (an attachment or a message's raw MIME) as bytes. */
  async download(blobId: string, name = "attachment", type = "application/octet-stream"): Promise<{ bytes: ArrayBuffer; type: string }> {
    const response = await this.openDownload(blobId, name, type);
    return { bytes: await response.arrayBuffer(), type: response.headers.get("content-type") ?? type };
  }

  /** Upload bytes for an Email/set create; returns the blob id to reference. */
  async upload(bytes: ArrayBuffer, type: string): Promise<{ blobId: string; size: number }> {
    const session = await this.session();
    const url = session.uploadUrl.replace("{accountId}", encodeURIComponent(session.accountId));
    const response = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": type },
      body: bytes,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const blobId = isRecord(payload) && typeof payload.blobId === "string" ? payload.blobId : "";
    if (!response.ok || !blobId) throw new JmapError(`Upload failed (${response.status}).`, response.status);
    return { blobId, size: typeof payload === "object" && payload !== null && "size" in payload ? Number(payload.size) || 0 : bytes.byteLength };
  }
}

// ── Mailflare's JMAP mailbox ids ────────────────────────────────────────

export const SYSTEM_ROLES = ["inbox", "sent", "drafts", "archive", "junk", "trash"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** The folder keys the app navigates with, mapped onto a JMAP mailbox id. */
const FOLDER_ALIASES: Record<string, SystemRole> = {
  inbox: "inbox",
  received: "inbox",
  sent: "sent",
  draft: "drafts",
  drafts: "drafts",
  archive: "archive",
  archived: "archive",
  spam: "junk",
  junk: "junk",
  trash: "trash",
};

export interface MailboxRef {
  mailboxId: string;
  role: SystemRole | null;
  folderId: string | null;
}

/** Decode one of the server's JMAP mailbox ids. */
export function decodeMailboxId(id: string): MailboxRef | null {
  const parts = id.split("~");
  if (parts.length === 1 && parts[0]) return { mailboxId: parts[0], role: null, folderId: null };
  if (parts.length === 2 && (SYSTEM_ROLES as readonly string[]).includes(parts[1] ?? "")) {
    return { mailboxId: parts[0] ?? "", role: parts[1] as SystemRole, folderId: null };
  }
  if (parts.length === 3 && parts[1] === "f" && parts[2]) return { mailboxId: parts[0] ?? "", role: null, folderId: parts[2] };
  return null;
}

/** The JMAP mailbox id for one folder key ("inbox", "trash", a folder id...). */
export function encodeMailboxId(mailboxId: string, folder: string | null | undefined): string {
  if (!folder || folder === "all") return mailboxId;
  const role = FOLDER_ALIASES[folder];
  if (role) return `${mailboxId}~${role}`;
  // A queued/scheduled message is a Sent message as far as JMAP is concerned.
  if (folder === "scheduled") return `${mailboxId}~sent`;
  return `${mailboxId}~f~${folder}`;
}

/** The app's folder/status key for a JMAP mailbox id. */
export function folderOfMailboxId(id: string): string {
  const ref = decodeMailboxId(id);
  if (!ref) return "inbox";
  if (ref.folderId) return ref.folderId;
  switch (ref.role) {
    case "sent":
      return "sent";
    case "drafts":
      return "draft";
    case "archive":
      return "archived";
    case "junk":
      return "spam";
    case "trash":
      return "trash";
    default:
      return "received";
  }
}
