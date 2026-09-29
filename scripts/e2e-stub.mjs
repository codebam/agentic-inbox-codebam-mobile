#!/usr/bin/env node
/**
 * Sanitizing check, no credentials needed: boots the app with a stubbed scoped
 * API that serves a hostile message body, then asserts nothing
 * sender-controlled can run or load.
 *
 *   node scripts/e2e-stub.mjs
 */
import { createServer } from "node:http";

import { assert, report, startHarness, startStaticServer } from "./e2e-lib.mjs";

const DIST = process.env.E2E_DIST ?? "dist-web";
const PORT = Number(process.env.E2E_PORT ?? 8144);
const TRACKER_PORT = Number(process.env.E2E_TRACKER_PORT ?? 8145);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MAILBOX = "demo@example.test";
const SUBJECT = "Crafted message";
const HOSTILE_BODY = [
  "<p>Hello from Eve</p>",
  '<script>window.__pwned = 1; document.title = "pwned";</script>',
  `<img src="http://127.0.0.1:${TRACKER_PORT}/tracker.gif" alt="Pixel">`,
  '<a href="javascript:alert(1)">click me</a>',
  `<iframe src="http://127.0.0.1:${TRACKER_PORT}/frame.html"></iframe>`,
  "<style>body { background: red }</style>",
].join("");

let trackerHits = 0;
const tracker = createServer((request, res) => {
  trackerHits += 1;
  console.log(`  tracker hit: ${request.url}`);
  res.writeHead(200, { "Content-Type": "image/gif" });
  res.end("GIF89a");
});
await new Promise((resolve) => tracker.listen(TRACKER_PORT, "127.0.0.1", resolve));

const staticServer = await startStaticServer(DIST, PORT);
const harness = await startHarness({
  profileSuffix: "stub",
  beforeBoot: async (page) => {
    await page.evaluateOnNewDocument(
      (config) => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = String(input);
          if (!url.includes("/api/v1/scoped/")) return original(input, init);
          const tool = url.split("/api/v1/scoped/")[1];
          const ok = (payload) =>
            new Response(JSON.stringify({ ok: true, result: payload }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          if (tool === "list_mailboxes") return ok([{ id: config.mailbox, email: config.mailbox }]);
          if (tool === "list_emails")
            return ok([
              {
                id: "m1",
                subject: config.subject,
                sender: "Eve <eve@evil.test>",
                date: new Date().toISOString(),
                read: false,
                folder_id: "inbox",
                folder_name: "Inbox",
                thread_id: "t1",
                snippet: "Hello there",
              },
            ]);
          if (tool === "get_email")
            return ok({
              id: "m1",
              subject: config.subject,
              sender: "Eve <eve@evil.test>",
              recipient: config.mailbox,
              cc: null,
              date: new Date().toISOString(),
              folder_id: "inbox",
              folder_name: "Inbox",
              thread_id: "t1",
              body: config.body,
              body_text: "Hello from Eve",
              attachments: [],
            });
          return ok({});
        };
      },
      { mailbox: MAILBOX, subject: SUBJECT, body: HOSTILE_BODY },
    );
  },
});
const { page } = harness;

let ok = true;
try {
  await page.goto(`${URL_BASE}/`, { waitUntil: "networkidle2" });
  await harness.waitText("Agentic Inbox Codebam");
  await harness.typeInto("input", `ain2_${"x".repeat(43)}`);
  await harness.clickText("Connect");
  await harness.waitText(MAILBOX, 20000);
  await harness.clickText(MAILBOX);
  await harness.waitText("Inbox", 20000);
  await harness.clickText("Inbox");
  await harness.waitText(SUBJECT, 20000);
  await harness.clickText(SUBJECT);
  await page.waitForSelector("iframe", { timeout: 20000 });

  const srcdoc = await page.evaluate(() => document.querySelector("iframe")?.getAttribute("srcdoc") ?? "");
  assert(srcdoc.length > 0, "message frame rendered");
  assert(srcdoc.includes("default-src 'none'"), "locking CSP present");
  assert(!srcdoc.includes("<script"), "no script element reaches the frame");
  assert(!srcdoc.includes(`127.0.0.1:${TRACKER_PORT}`), "remote image and iframe URLs are gone");
  assert(!srcdoc.toLowerCase().includes("javascript:"), "javascript: URLs are stripped");
  assert(srcdoc.includes("🖼 Pixel"), "images become alt placeholders");
  assert(srcdoc.includes("Hello from Eve"), "body text survives");

  const mainFramePwned = await page.evaluate(() => typeof window.__pwned);
  assert(mainFramePwned === "undefined", "no script ran in the main frame");
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const pwned = await frame.evaluate(() => typeof window.__pwned);
      assert(pwned === "undefined", "no script ran inside the message frame");
    } catch (error) {
      console.log(`  (frame not evaluable, skipping: ${error.message})`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 750));
  assert(trackerHits === 0, `no request reached the sender's server (hits=${trackerHits})`);

  await harness.shot("stub-message");
  ok = report(harness);
  if (!ok) console.log("unexpected console/page errors above");
  console.log(ok ? "SMOKE OK (stub sanitizing)" : "SMOKE FAILED");
} catch (error) {
  ok = false;
  report(harness);
  console.error(`SMOKE FAILED: ${error.message}`);
  throw error;
} finally {
  await harness.close();
  await staticServer.close();
  await new Promise((resolve) => tracker.close(resolve));
}
process.exit(ok ? 0 : 1);
