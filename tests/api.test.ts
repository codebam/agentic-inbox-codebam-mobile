import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createSession, normalizeBaseUrl, ScopedApi, type Session } from "@/lib/api";

const HEX = "636f646562616d40636f646562616d2e6361";
const SECRET = "d5KRt9vQ2mXbW4zY7pLc1nJh8sA3fG6eU0iR2oT5wZq";
const MAILBOX_TOKEN = `ain1_${HEX}_${SECRET}`;
const APP_TOKEN = `ain2_${SECRET}`;
const BASE = "https://email.example.test";
const MAILBOX_ID = "codebam@codebam.ca";

function mailboxSession(): Session {
  const session = createSession(BASE, MAILBOX_TOKEN);
  if (!session) throw new Error("fixture token failed to parse");
  return session;
}

function appSession(): Session {
  const session = createSession(BASE, APP_TOKEN);
  if (!session) throw new Error("fixture token failed to parse");
  return session;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Call {
  url: string;
  init: RequestInit;
}

const calls: Call[] = [];

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return handler(String(url), init ?? {});
    }),
  );
}

function lastBody(): Record<string, unknown> {
  const call = calls.at(-1);
  if (!call) throw new Error("no call was made");
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createSession / normalizeBaseUrl", () => {
  it("derives kind and mailbox from the token", () => {
    const session = mailboxSession();
    expect(session.kind).toBe("mailbox");
    expect(session.mailboxId).toBe(MAILBOX_ID);
    expect(appSession().mailboxId).toBeNull();
  });

  it("refuses a key that is neither wire shape", () => {
    expect(createSession(BASE, "not-a-key")).toBeNull();
  });

  it("normalizes the server URL", () => {
    expect(normalizeBaseUrl("email.example.test/")).toBe("https://email.example.test");
    expect(normalizeBaseUrl("http://100.1.2.3:5173///")).toBe("http://100.1.2.3:5173");
    expect(normalizeBaseUrl("")).toBe("https://email.codebam.ca");
  });
});

describe("scoped-key wire shape", () => {
  it("never sends a mailboxId, and sends the bearer key", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: [] }));
    const api = new ScopedApi(mailboxSession());
    await api.listEmails(MAILBOX_ID, "inbox", { limit: 5, page: 2 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/scoped/list_emails`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${MAILBOX_TOKEN}`);
    const body = lastBody();
    expect(Object.keys(body)).not.toContain("mailboxId");
    expect(body).toMatchObject({ folder: "inbox", limit: 5, page: 2 });
  });

  it("refuses to use the key against another mailbox before any request", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: [] }));
    const api = new ScopedApi(mailboxSession());
    await expect(api.listEmails("someone@else.test", "inbox")).rejects.toThrow(/scoped to a single mailbox/);
    expect(calls).toHaveLength(0);
  });

  it("refuses the app-only tools", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: [] }));
    const api = new ScopedApi(mailboxSession());
    await expect(api.listMailboxes()).rejects.toThrow(/Only a global key/);
    await expect(api.searchAllMailboxes({ query: "x" })).rejects.toThrow(/Only a global key/);
    expect(calls).toHaveLength(0);
  });
});

describe("global-key wire shape", () => {
  it("names the mailbox on every mailbox-scoped call", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: [] }));
    const api = new ScopedApi(appSession());
    await api.listEmails(MAILBOX_ID, "draft", {});

    expect(calls[0]?.url).toBe(`${BASE}/api/v1/scoped/list_emails`);
    expect(lastBody()).toMatchObject({ mailboxId: MAILBOX_ID, folder: "draft" });
  });

  it("refuses a mailbox-scoped call that names no mailbox", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: [] }));
    const api = new ScopedApi(appSession());
    await expect(api.getEmail(null, "abc")).rejects.toThrow(/reaches every mailbox/);
    expect(calls).toHaveLength(0);
  });

  it("calls the all-mailbox reads without a mailboxId", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: [{ id: MAILBOX_ID, email: MAILBOX_ID }] }));
    const api = new ScopedApi(appSession());
    const mailboxes = await api.listMailboxes();
    expect(calls[0]?.url).toBe(`${BASE}/api/v1/scoped/list_mailboxes`);
    expect(Object.keys(lastBody())).not.toContain("mailboxId");
    expect(mailboxes).toEqual([{ id: MAILBOX_ID, email: MAILBOX_ID }]);
  });
});

describe("error mapping", () => {
  it("maps the surface's 401", async () => {
    stubFetch(() => jsonResponse({ error: "Invalid or revoked access token" }, 401));
    const api = new ScopedApi(mailboxSession());
    const failure = api.listEmails(MAILBOX_ID, "inbox");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await failure.catch((error: ApiError) => {
      expect(error.status).toBe(401);
      expect(error.message).toBe("Invalid or revoked access token");
      expect(error.isAuthError).toBe(true);
    });
  });

  it("maps scope and tool refusals", async () => {
    stubFetch(() => jsonResponse({ error: "This token lacks the send scope" }, 403));
    const api = new ScopedApi(mailboxSession());
    await expect(api.sendEmail(MAILBOX_ID, { to: "a@b.test", subject: "s", body: "b" })).rejects.toMatchObject({
      status: 403,
      message: "This token lacks the send scope",
    });
  });

  it("falls back to the status when the body is not JSON", async () => {
    stubFetch(() => new Response("bad gateway", { status: 502 }));
    const api = new ScopedApi(mailboxSession());
    await expect(api.listEmails(MAILBOX_ID, "inbox")).rejects.toMatchObject({ status: 502, message: "Request failed (502)" });
  });

  it("unwraps the result on success", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: { status: "sent", messageId: "m1", message: "Reply sent to a@b.test" } }));
    const api = new ScopedApi(mailboxSession());
    const result = await api.sendEmail(MAILBOX_ID, { to: "a@b.test", subject: "s", body: "hello" });
    expect(result.status).toBe("sent");
    const body = lastBody();
    expect(String(body.bodyHtml)).toContain("white-space:pre-wrap");
  });

  it("reports an unreachable server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    );
    const api = new ScopedApi(mailboxSession());
    await expect(api.listEmails(MAILBOX_ID, "inbox")).rejects.toMatchObject({
      status: 0,
      message: "Couldn't reach email.example.test. Check the server URL and your connection.",
    });
  });

  it("times out a hanging request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );
    const api = new ScopedApi(appSession());
    const pending = api.listMailboxes();
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, message: /timed out/ });
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
  });
});

describe("manage tools", () => {
  it("sends the manage calls under a scoped key without a mailboxId", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: { status: "updated", emailId: "e1" } }));
    const api = new ScopedApi(mailboxSession());

    await api.markEmailRead(MAILBOX_ID, "e1", false);
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/mark_email_read`);
    expect(lastBody()).toMatchObject({ emailId: "e1", read: false });
    expect(Object.keys(lastBody())).not.toContain("mailboxId");

    await api.starEmail(MAILBOX_ID, "e1", true);
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/star_email`);
    expect(lastBody()).toMatchObject({ emailId: "e1", starred: true });

    await api.moveEmail(MAILBOX_ID, "e1", "archive");
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/move_email`);
    expect(lastBody()).toMatchObject({ emailId: "e1", folderId: "archive" });

    await api.deleteEmail(MAILBOX_ID, "e1");
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/delete_email`);
    expect(lastBody()).toMatchObject({ emailId: "e1", permanent: false });

    await api.snoozeEmail(MAILBOX_ID, "e1", "3h");
    expect(lastBody()).toMatchObject({ emailId: "e1", until: "3h" });

    await api.unsnoozeEmail(MAILBOX_ID, "e1");
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/unsnooze_email`);
    expect(lastBody()).toMatchObject({ emailId: "e1" });

    await api.setSenderPolicy(MAILBOX_ID, "e1", "block");
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/set_sender_policy`);
    expect(lastBody()).toMatchObject({ emailId: "e1", policy: "block" });

    await api.unsubscribeEmail(MAILBOX_ID, "e1");
    expect(calls.at(-1)?.url).toBe(`${BASE}/api/v1/scoped/unsubscribe_email`);
    expect(lastBody()).toMatchObject({ emailId: "e1" });
  });

  it("names the mailbox on manage calls under a global key", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: { status: "moved" } }));
    const api = new ScopedApi(appSession());
    await api.moveEmail(MAILBOX_ID, "e1", "trash");
    expect(lastBody()).toMatchObject({ mailboxId: MAILBOX_ID, emailId: "e1", folderId: "trash" });
  });

  it("refuses a manage call that names another mailbox under a scoped key", async () => {
    stubFetch(() => jsonResponse({ ok: true, result: {} }));
    const api = new ScopedApi(mailboxSession());
    await expect(api.deleteEmail("someone@else.test", "e1")).rejects.toThrow(/scoped to a single mailbox/);
    expect(calls).toHaveLength(0);
  });
});
