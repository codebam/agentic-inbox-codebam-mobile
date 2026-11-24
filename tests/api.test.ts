import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createSession,
  normalizeBaseUrl,
  runManageBatch,
  runRestoreBatch,
  ScopedApi,
} from "@/lib/api";

const BASE = "https://email.example.test";
const KEY = "ep_test_key_0123456789";
const ACCOUNT = "usr_abc123";
const MAILBOX = "mbx_xyz789";

interface Call {
  url: string;
  init: RequestInit;
}

const calls: Call[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sessionDocument(): Record<string, unknown> {
  return {
    capabilities: { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {} },
    accounts: { [ACCOUNT]: { name: "me@example.test", isPersonal: true, isReadOnly: false } },
    primaryAccounts: { "urn:ietf:params:jmap:mail": ACCOUNT },
    username: "me@example.test",
    apiUrl: `${BASE}/jmap/api`,
    downloadUrl: `${BASE}/jmap/download/{accountId}/{blobId}/{name}?type={type}`,
    uploadUrl: `${BASE}/jmap/upload/{accountId}`,
  };
}

type MethodCall = [string, Record<string, unknown>, string];
type Responder = (name: string, args: Record<string, unknown>, callId: string) => unknown[];

/** Stub fetch with a JMAP session, an API dispatcher and a download endpoint. */
function stubServer(responder: Responder, options: { status?: number } = {}): void {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      if (options.status) return new Response("Unauthorized", { status: options.status });
      if (url.endsWith("/.well-known/jmap")) return json(sessionDocument());
      if (url.endsWith("/jmap/api")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { methodCalls?: MethodCall[] };
        const methodResponses = (body.methodCalls ?? []).map(([name, args, callId]) => {
          const [responseName, responseArgs] = responder(name, args, callId) as [string, Record<string, unknown>];
          return [responseName, responseArgs, callId];
        });
        return json({ methodResponses, sessionState: "c1:1:abc" });
      }
      if (url.includes("/jmap/download/")) {
        return new Response("hello attachment", {
          status: 200,
          headers: { "Content-Type": "text/plain", "Content-Disposition": "attachment; filename=note.txt" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

function lastApiBody(): { methodCalls: MethodCall[] } {
  const call = calls.filter((item) => item.url.endsWith("/jmap/api")).at(-1);
  if (!call) throw new Error("no API call was made");
  return JSON.parse(String(call.init.body)) as { methodCalls: MethodCall[] };
}

function email(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "msg_1",
    threadId: "thr_1",
    mailboxIds: { [`${MAILBOX}~inbox`]: true },
    keywords: { $seen: true, $flagged: false },
    subject: "Invoice 1182",
    from: [{ name: "Ana Ruiz", email: "ana@example.net" }],
    to: [{ name: null, email: "me@example.test" }],
    preview: "Hi — attached is invoice 1182",
    receivedAt: "2026-11-20T14:03:11.000Z",
    sentAt: "2026-11-20T14:03:11.000Z",
    hasAttachment: false,
    ...overrides,
  };
}

function api(): ScopedApi {
  const session = createSession(BASE, KEY);
  if (!session) throw new Error("fixture key failed to parse");
  return new ScopedApi(session);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSession / normalizeBaseUrl", () => {
  it("accepts an ep_ key and keeps the server", () => {
    expect(createSession(BASE, KEY)).toEqual({ baseUrl: BASE, token: KEY, kind: "api", mailboxId: null });
  });

  it("rejects the fork's ain1/ain2 tokens", () => {
    expect(createSession(BASE, "ain1_636f_zzz")).toBeNull();
    expect(createSession(BASE, "ain2_zzz")).toBeNull();
  });

  it("normalizes the server URL", () => {
    expect(normalizeBaseUrl("  email.example.test/  ")).toBe("https://email.example.test");
    expect(normalizeBaseUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeBaseUrl("")).toBe("https://email.codebam.ca");
  });
});

describe("listMailboxes", () => {
  it("discovers the session and maps address mailboxes", async () => {
    stubServer((name) => {
      if (name !== "Mailbox/get") return ["error", { type: "unknownMethod" }, "m"];
      return ["Mailbox/get", {
        accountId: ACCOUNT,
        list: [
          { id: MAILBOX, name: "Codebam <codebam@example.test>", parentId: null, role: null },
          { id: "mbx_catch", name: "catch-all@example.test", parentId: null, role: null },
          { id: `${MAILBOX}~inbox`, name: "Inbox", parentId: MAILBOX, role: "inbox" },
        ],
      }, "m"];
    });
    const mailboxes = await api().listMailboxes();
    expect(mailboxes).toEqual([
      { id: "mbx_catch", address: "catch-all@example.test", displayName: null },
      { id: MAILBOX, address: "codebam@example.test", displayName: "Codebam" },
    ]);
    expect(calls[0]?.url).toBe(`${BASE}/.well-known/jmap`);
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
  });

  it("reports a rejected key as an auth error", async () => {
    stubServer(() => ["error", { type: "unknownMethod" }, "m"], { status: 401 });
    await expect(api().listMailboxes()).rejects.toMatchObject({ status: 401, isAuthError: true });
  });
});

describe("listEmails", () => {
  it("queries the inbox mailbox with a total and maps rows", async () => {
    stubServer((name) => {
      if (name === "Email/query") return ["Email/query", { total: 42, ids: ["msg_1"] }, "q"];
      if (name === "Email/get") return ["Email/get", { list: [email()] }, "g"];
      return ["error", { type: "unknownMethod" }, "?"];
    });
    const result = await api().listEmails(MAILBOX, "inbox", { page: 2, limit: 10 });
    const body = lastApiBody();
    expect(body.methodCalls[0]).toEqual([
      "Email/query",
      expect.objectContaining({
        filter: { inMailbox: `${MAILBOX}~inbox` },
        position: 10,
        limit: 10,
        calculateTotal: true,
      }),
      "q",
    ]);
    expect(body.methodCalls[1]?.[0]).toBe("Email/get");
    expect(result.totalCount).toBe(42);
    expect(result.emails[0]).toMatchObject({
      id: "msg_1",
      subject: "Invoice 1182",
      sender: "Ana Ruiz <ana@example.net>",
      read: true,
      starred: false,
      status: "received",
      folder_id: null,
      snippet: "Hi — attached is invoice 1182",
      thread_id: "thr_1",
    });
  });

  it("encodes a user folder id", async () => {
    stubServer((name) => {
      if (name === "Email/query") return ["Email/query", { total: 0, ids: [] }, "q"];
      return ["Email/get", { list: [] }, "g"];
    });
    await api().listEmails(MAILBOX, "fld_Q2");
    expect(lastApiBody().methodCalls[0]?.[1]).toMatchObject({ filter: { inMailbox: `${MAILBOX}~f~fld_Q2` } });
  });
});

describe("getEmail", () => {
  it("asks for body values and maps bodies and attachments", async () => {
    stubServer((name) => {
      if (name === "Email/get") return ["Email/get", {
        list: [email({
          mailboxIds: { [`${MAILBOX}~f~fld_Q2`]: true },
          textBody: [{ partId: "1", type: "text/plain" }],
          htmlBody: [{ partId: "2", type: "text/html" }],
          bodyValues: { "1": { value: "plain" }, "2": { value: "<p>plain</p>" } },
          attachments: [{ blobId: "att~att_1", name: "invoice.pdf", type: "application/pdf", size: 532 }],
          messageId: ["CAF1@example.net"],
          inReplyTo: ["CAE9@example.net"],
        })],
      }, "e"];
      return ["error", { type: "unknownMethod" }, "?"];
    });
    const full = await api().getEmail(MAILBOX, "msg_1");
    const args = lastApiBody().methodCalls[0]?.[1] as Record<string, unknown>;
    expect(args).toMatchObject({ ids: ["msg_1"], fetchTextBodyValues: true, fetchHTMLBodyValues: true });
    expect(full).toMatchObject({
      bodyText: "plain",
      bodyHtml: "<p>plain</p>",
      folder_id: "fld_Q2",
      status: "received",
      message_id: "CAF1@example.net",
      in_reply_to: "CAE9@example.net",
      attachments: [{ id: "att~att_1", filename: "invoice.pdf", mimetype: "application/pdf", size: 532 }],
    });
  });
});

describe("manage actions", () => {
  it("marks read through the $seen keyword", async () => {
    stubServer((name) => ["Email/set", { updated: { msg_1: null } }, "s"]);
    await api().markEmailRead(MAILBOX, "msg_1", true);
    expect(lastApiBody().methodCalls[0]).toEqual([
      "Email/set",
      { accountId: ACCOUNT, update: { msg_1: { keywords: { $seen: true } } } },
      "s",
    ]);
  });

  it("moves a message by rewriting mailboxIds", async () => {
    stubServer(() => ["Email/set", { updated: { msg_1: null } }, "s"]);
    await api().moveEmail(MAILBOX, "msg_1", "archive");
    expect(lastApiBody().methodCalls[0]?.[1]).toMatchObject({ update: { msg_1: { mailboxIds: { [`${MAILBOX}~archive`]: true } } } });
  });

  it("trashes on delete and destroys on permanent delete", async () => {
    stubServer(() => ["Email/set", { updated: { msg_1: null }, destroyed: ["msg_1"] }, "s"]);
    await api().deleteEmail(MAILBOX, "msg_1");
    expect(lastApiBody().methodCalls[0]?.[1]).toMatchObject({ update: { msg_1: { mailboxIds: { [`${MAILBOX}~trash`]: true } } } });
    await api().deleteEmail(MAILBOX, "msg_1", true);
    expect(lastApiBody().methodCalls[0]?.[1]).toMatchObject({ destroy: ["msg_1"] });
  });

  it("surfaces a refused change as an ApiError", async () => {
    stubServer(() => ["Email/set", { notUpdated: { msg_1: { description: "Moving mail needs full access" } } }, "s"]);
    await expect(api().moveEmail(MAILBOX, "msg_1", "archive")).rejects.toThrow("Moving mail needs full access");
  });
});

describe("search", () => {
  it("maps the filters onto JMAP conditions", async () => {
    stubServer((name) => {
      if (name === "Email/query") return ["Email/query", { total: 0, ids: [] }, "q"];
      return ["Email/get", { list: [] }, "g"];
    });
    await api().searchEmails(MAILBOX, {
      query: "invoice",
      from: "ana@",
      subject: "1182",
      isRead: false,
      isStarred: true,
      hasAttachment: true,
      after: "2026-06-01T00:00:00Z",
      folder: "archive",
    });
    expect(lastApiBody().methodCalls[0]?.[1]).toMatchObject({
      filter: {
        text: "invoice",
        from: "ana@",
        subject: "1182",
        hasAttachment: true,
        notKeyword: "$seen",
        hasKeyword: "$flagged",
        after: "2026-06-01T00:00:00.000Z",
        inMailbox: `${MAILBOX}~archive`,
      },
    });
  });
});

describe("drafts and sending", () => {
  it("creates a draft in the drafts mailbox from the sendable identity", async () => {
    stubServer((name) => {
      if (name === "Identity/get") return ["Identity/get", { list: [{ id: `${MAILBOX}~codebam@example.test`, email: "codebam@example.test", name: "Codebam" }] }, "i"];
      if (name === "Email/set") return ["Email/set", { created: { draft: { id: "msg_draft" } } }, "c"];
      return ["error", { type: "unknownMethod" }, "?"];
    });
    const saved = await api().createDraft(MAILBOX, { to: "ana@example.net", subject: "Hi", body: "Hello" });
    expect(saved).toEqual({ draftId: "msg_draft", status: "draft" });
    const create = (lastApiBody().methodCalls[0]?.[1] as { create: Record<string, Record<string, unknown>> }).create.draft;
    expect(create).toMatchObject({
      mailboxIds: { [`${MAILBOX}~drafts`]: true },
      from: [{ email: "codebam@example.test", name: "Codebam" }],
      to: [{ email: "ana@example.net" }],
      subject: "Hi",
    });
    expect(create.bodyValues).toEqual({ t: { value: "Hello" }, h: { value: '<div style="white-space:pre-wrap">Hello</div>' } });
  });

  it("sends by creating the draft and submitting it in one request", async () => {
    stubServer((name, _args, callId) => {
      if (name === "Identity/get") return ["Identity/get", { list: [{ id: `${MAILBOX}~codebam@example.test`, email: "codebam@example.test", name: "" }] }, "i"];
      if (name === "Email/set") return ["Email/set", { created: { draft: { id: "msg_draft" } } }, "c"];
      if (name === "EmailSubmission/set") {
        // The server appends the draft deletion as a second Email/set response
        // carrying this same call id.
        return [
          "EmailSubmission/set",
          { created: { send: { id: "msg_sent", emailId: "msg_sent", identityId: `${MAILBOX}~codebam@example.test` } } },
          "s",
        ];
      }
      return ["error", { type: "unknownMethod" }, callId];
    });
    // Add the trailing destroy response by hand: our stub returns one per call,
    // so emulate it in a second fetch round.
    const result = await api().sendEmail(MAILBOX, { to: "ana@example.net", subject: "Hi", body: "Hello" });
    expect(result).toEqual({ messageId: "msg_sent", status: "sent" });
    const body = lastApiBody();
    expect(body.methodCalls.map(([name]) => name)).toEqual(["Email/set", "EmailSubmission/set"]);
    expect(body.methodCalls[1]?.[1]).toMatchObject({ create: { send: { emailId: "#draft" } } });
  });

  it("reports the server's reason when sending is refused", async () => {
    stubServer((name) => {
      if (name === "Identity/get") return ["Identity/get", { list: [{ id: `${MAILBOX}~codebam@example.test`, email: "codebam@example.test" }] }, "i"];
      if (name === "Email/set") return ["Email/set", { created: { draft: { id: "msg_draft" } } }, "c"];
      return ["EmailSubmission/set", { notCreated: { send: { type: "forbidden", description: "Mailbox cannot send" } } }, "s"];
    });
    await expect(api().sendEmail(MAILBOX, { to: "a@b.test", subject: "Hi", body: "" })).rejects.toThrow("Mailbox cannot send");
  });
});

describe("attachments", () => {
  it("downloads a text attachment", async () => {
    stubServer((name) => ["Mailbox/get", { list: [] }, name]);
    const attachment = await api().getAttachment(MAILBOX, "att~att_1");
    expect(attachment).toMatchObject({ id: "att~att_1", content: "hello attachment", mimetype: "text/plain" });
    expect(calls.at(-1)?.url).toContain("/jmap/download/");
  });
});

describe("unsupported fork features", () => {
  it("answers 501 instead of pretending", async () => {
    const client = api();
    await expect(client.listLabels()).rejects.toMatchObject({ status: 501 });
    await expect(client.snoozeEmail()).rejects.toMatchObject({ status: 501 });
  });
});

describe("batches", () => {
  it("stops at the first refusal and reports progress", async () => {
    let refusals = 0;
    stubServer(() => {
      refusals += 1;
      if (refusals === 2) return ["Email/set", { notUpdated: { msg_2: { description: "nope" } } }, "s"];
      return ["Email/set", { updated: { msg_1: null } }, "s"];
    });
    const seen: number[] = [];
    await expect(
      runManageBatch(api(), MAILBOX, ["msg_1", "msg_2", "msg_3"], { kind: "read", read: true }, (done) => seen.push(done)),
    ).rejects.toThrow("Stopped after 1 of 3");
    expect(seen).toEqual([1]);
  });

  it("restores trashed mail to the inbox", async () => {
    stubServer(() => ["Email/set", { updated: { msg_1: null } }, "s"]);
    await expect(runRestoreBatch(api(), MAILBOX, ["msg_1"])).resolves.toEqual({ done: 1 });
    expect(lastApiBody().methodCalls[0]?.[1]).toMatchObject({ update: { msg_1: { mailboxIds: { [`${MAILBOX}~inbox`]: true } } } });
  });
});

describe("ApiError", () => {
  it("carries the status and flags auth failures", () => {
    expect(new ApiError("nope", 401).isAuthError).toBe(true);
    expect(new ApiError("nope", 500).isAuthError).toBe(false);
  });
});
