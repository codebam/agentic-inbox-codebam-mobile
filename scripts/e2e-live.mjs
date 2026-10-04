#!/usr/bin/env node
/**
 * Live end-to-end check: drives the exported web build in headless Chromium
 * against a real deployment, exactly like a user would.
 *
 *   MCP_KEY='ain2_…' node scripts/e2e-live.mjs
 *
 * Env:
 *   MCP_KEY      (required) the key the app should connect with
 *   E2E_BASE     server URL      (default https://email.codebam.ca)
 *   E2E_MAILBOX  mailbox to open (default codebam@codebam.ca; must be the
 *                mailbox a scoped key is bound to when testing one)
 *   E2E_DIST     web export dir  (default dist-web)
 *   E2E_PORT     static port     (default 8144)
 */
import { assert, report, startHarness, startStaticServer } from "./e2e-lib.mjs";

const KEY = process.env.MCP_KEY;
if (!KEY) {
  console.error("MCP_KEY is required (the key the app should connect with)");
  process.exit(2);
}
const MAILBOX = process.env.E2E_MAILBOX ?? "codebam@codebam.ca";
const DIST = process.env.E2E_DIST ?? "dist-web";
const PORT = Number(process.env.E2E_PORT ?? 8144);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const MAILBOX_URL = `${URL_BASE}/m/${encodeURIComponent(MAILBOX)}`;
const IS_APP_KEY = KEY.startsWith("ain2_");
const KIND_LABEL = IS_APP_KEY ? "Global key (every mailbox)" : "Scoped key (one mailbox)";
const DRAFT_SUBJECT = "Re: Appointment Confirmed";
// The script's own API base for state checks; the app build carries its own.
const BASE = process.env.E2E_BASE ?? "https://email.codebam.ca";

/** Call the deployment's scoped surface directly (script-side assertions). */
async function apiCall(tool, body) {
  const response = await fetch(`${BASE}/api/v1/scoped/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${tool} answered ${response.status}: ${JSON.stringify(json)}`);
  return json?.result ?? json;
}

const staticServer = await startStaticServer(DIST, PORT);
const harness = await startHarness({ profileSuffix: "live" });
const { page } = harness;

let ok = true;
try {
  // 1. Connect screen.
  await page.goto(`${URL_BASE}/`, { waitUntil: "networkidle2" });
  await harness.waitText("Agentic Inbox Codebam");
  await harness.waitText("Connect");
  console.log("1. connect screen shown");

  // 2. A bogus scoped key is validated against the server and refused.
  const bogus = `ain1_636f646562616d40636f646562616d2e6361_${"A".repeat(43)}`;
  await harness.typeInto("input", bogus);
  await harness.clickText("Connect");
  await harness.waitText("Invalid or revoked access token", 30000);
  assert(
    (await page.evaluate(() => localStorage.getItem("agentic-inbox.session"))) === null,
    "a refused key must not be stored",
  );
  await harness.shot("01-key-refused");
  console.log("2. bogus scoped key refused by the server, nothing stored");

  // 3. The real key connects.
  await page.click("input", { clickCount: 3 });
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  const emptied = await page.evaluate(() => (document.querySelector("input")?.value ?? "?") === "");
  assert(emptied, "the key field must be empty before the real key is typed");
  await harness.typeInto("input", KEY);
  await harness.clickText("Connect");
  if (IS_APP_KEY) {
    await harness.waitText(MAILBOX, 30000);
    const stored = await page.evaluate(() => localStorage.getItem("agentic-inbox.session"));
    assert(stored !== null && stored.includes(KEY), "the accepted key is stored");
    await harness.shot("02-mailboxes");
    console.log("3. connected; mailboxes listed");
    await harness.clickText(MAILBOX);
  } else {
    await harness.waitText(MAILBOX, 30000);
    console.log("3. connected with a scoped key; mailbox shown");
  }

  // 4. Folders.
  await harness.waitText("Inbox", 30000);
  await harness.waitText("Drafts");
  await harness.waitText("Trash");
  await harness.shot("03-folders");
  console.log("4. folders shown");

  // 5. Inbox list.
  await harness.clickText("Inbox");
  await harness.waitText("Appointment Confirmed", 30000);
  await harness.shot("04-inbox");
  console.log("5. inbox rows loaded");

  // 6. Search through the header button.
  await harness.clickAria("Search");
  await page.waitForSelector('input[placeholder^="Search this mailbox"]', { timeout: 20000 });
  await harness.typeInto("input", "Linux");
  await page.keyboard.press("Enter");
  await harness.waitText("Open Source Week", 30000);
  await harness.shot("05-search");
  console.log("6. search returned live results");

  // 7. Open the top result; the body renders in a locked sandboxed frame.
  await harness.clickText("Appointment Confirmed");
  await harness.waitText("Appointment Confirmed", 30000);
  await page.waitForSelector("iframe", { timeout: 20000 });
  const srcdoc = await page.evaluate(() => document.querySelector("iframe")?.getAttribute("srcdoc") ?? "");
  assert(srcdoc.includes("default-src 'none'"), "message document carries the locking CSP");
  assert(srcdoc.includes("info@linuxassociation.ca"), "message document shows the sender");
  await harness.shot("06-message");
  console.log("7. message detail rendered in a sandboxed frame");

  // 8. Plain-text toggle.
  await harness.clickAria("Show plain text");
  await harness.waitAria("Show formatted message");
  await harness.shot("07-plain-text");
  await harness.clickAria("Show formatted message");
  await harness.waitAria("Show plain text");
  console.log("8. plain-text toggle works");

  // 8a. Message images: a message that carries remote images gets them
  // fetched through the deployment's get_image relay and inlined as data:
  // URLs; a message without any keeps the text placeholders. Either state
  // is fine — this leg reports which one the fixture message is in.
  const imageState = await page
    .waitForFunction(
      () => {
        const srcdoc = document.querySelector("iframe")?.getAttribute("srcdoc") ?? "";
        if (srcdoc.includes("data:image")) return "loaded";
        if (srcdoc.includes("ai-image")) return "placeholder";
        return false;
      },
      { timeout: 30000, polling: 500 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  if (imageState === "loaded") {
    console.log("8a. message images loaded through the relay (data: URLs inlined)");
  } else if (imageState === "placeholder") {
    console.log("8a. message carries no loadable remote images; placeholders shown");
  } else {
    console.log("8a. image state not observed in the window (message may still be resolving)");
  }

  // 8b. Manage bar: a star tap must reach the live surface and come back
  // 200 (manage-scoped key; the label then flips and the second tap
  // restores it) or 403 (a key without the scope; the refusal is shown).
  // The message may already be starred, so the leg works from either state.
  const starLabel = await page.evaluate(
    () =>
      ["Star", "Unstar"].find((label) =>
        [...document.querySelectorAll(`[aria-label="${label}"]`)].some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }),
      ) ?? null,
  );
  assert(starLabel !== null, "the manage bar shows a star toggle");
  const otherLabel = starLabel === "Star" ? "Unstar" : "Star";
  const starResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/scoped/star_email"), { timeout: 30000 });
  await harness.clickAria(starLabel);
  const starStatus = (await starResponse).status();
  assert(starStatus === 200 || starStatus === 403, `star_email answered ${starStatus}`);
  if (starStatus === 200) {
    await harness.waitAria(otherLabel);
    const revertResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/scoped/star_email"), { timeout: 30000 });
    await harness.clickAria(otherLabel);
    await revertResponse;
    await harness.waitAria(starLabel);
    console.log(`8b. star tapped (${starLabel} -> ${otherLabel}) and restored`);
  } else {
    await harness.waitText("lacks the manage scope", 15000);
    console.log("8b. star refused by this key; the refusal is shown");
  }
  await harness.shot("07b-manage");
  console.log("8b. manage bar responded");

  // 9. Reply: the send path stops at a confirmation dialog; save a draft.
  await harness.clickText("Reply");
  await harness.waitText("Save draft", 20000);
  const inputValues = await page.evaluate(() =>
    [...document.querySelectorAll("input")].map((input) => input.value).join("|"),
  );
  assert(inputValues.includes("info@linuxassociation.ca"), `reply prefills the sender (saw ${inputValues})`);
  await harness.typeInto("textarea", "E2E check draft, safe to discard.");
  await harness.clickText("Send");
  await harness.waitText("Send reply?", 15000);
  await harness.shot("08-send-confirm");
  await harness.clickText("Cancel");
  await harness.waitGone("Send reply?", 15000);
  await harness.clickText("Save draft");
  await harness.waitText("Draft saved to Drafts.", 30000);
  await harness.shot("09-draft-saved");
  console.log("9. send confirmation cancelled, nothing sent; draft saved");

  // 10. Drafts: open the saved draft and discard it.
  await page.goto(`${MAILBOX_URL}/f/draft`, { waitUntil: "networkidle2" });
  await harness.waitText(DRAFT_SUBJECT, 30000);
  await harness.shot("10-drafts");
  await harness.clickText(DRAFT_SUBJECT);
  await harness.waitText("Discard", 20000);
  await harness.clickText("Discard");
  await harness.waitText("Discard draft?", 15000);
  await harness.clickText("Discard", { last: true });
  await harness.waitGone(DRAFT_SUBJECT, 30000);
  await harness.shot("11-draft-discarded");
  console.log("10. draft discarded");

  // 10b. Multi-select: pick a message in the list, star it through the
  // selection bar (a live runManageBatch call), confirm the star landed on
  // the server, put it back, and leave selection mode.
  await page.goto(`${MAILBOX_URL}/f/inbox`, { waitUntil: "networkidle2" });
  await harness.waitText("Appointment Confirmed", 30000);
  const inbox = await apiCall("list_emails", { mailboxId: MAILBOX, folder: "inbox", limit: 20 });
  const listed = Array.isArray(inbox) ? inbox : (inbox?.emails ?? []);
  const picked = listed.find((email) => String(email.subject ?? "").includes("Appointment Confirmed"));
  assert(picked && typeof picked.id === "string", "the inbox carries the Appointment Confirmed message");
  const wasStarred = picked.starred === true;

  await harness.clickAria("Select");
  await harness.waitText("0 selected", 20000);
  await harness.clickText("Appointment Confirmed");
  await harness.waitText("1 selected", 20000);
  const batchStar = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/scoped/star_email"),
    { timeout: 30000 },
  );
  await harness.clickAria("Star");
  const batchStatus = (await batchStar).status();
  await harness.shot("11b-multiselect");
  if (batchStatus === 403) {
    await harness.waitText("lacks the manage scope", 15000);
    console.log("10b. batch star refused by this key; the refusal is shown");
  } else {
    assert(batchStatus === 200, `batch star answered ${batchStatus}`);
    await harness.waitText("Starred: 1 of 1 messages.", 20000);
    const after = await apiCall("get_email", { mailboxId: MAILBOX, emailId: picked.id });
    assert((after?.email ?? after)?.starred === true, "the batch star landed on the server");
    await apiCall("star_email", { mailboxId: MAILBOX, emailId: picked.id, starred: wasStarred });
    console.log("10b. multi-select batch star landed on the live server and was restored");
  }
  // A successful batch leaves selection mode on its own; only the refusal
  // path still shows the confirm bar, so cancel only when it is there.
  const cancelVisible = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label="Cancel selection"]')].some((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }),
  );
  if (cancelVisible) {
    await harness.clickAria("Cancel selection");
  }
  await harness.waitGone("selected", 15000);

  // 10c. Message images end to end: send ourselves a message carrying one
  // remote image, wait for it to land in the inbox, open it in the app and
  // require the relayed image to appear as a data: URL in the rendered
  // document. Then remove the test message (trash, then permanent).
  const stamp = Date.now();
  const imageSubject = `E2E image check ${stamp}`;
  await apiCall("send_email", {
    mailboxId: MAILBOX,
    to: MAILBOX,
    subject: imageSubject,
    bodyHtml:
      '<p>Image relay check.</p><img src="https://httpbin.org/image/png" alt="relay check">',
  });
  let imageEmail = null;
  for (let attempt = 0; attempt < 30 && !imageEmail; attempt += 1) {
    const listed = await apiCall("list_emails", { mailboxId: MAILBOX, folder: "inbox", limit: 10 });
    const messages = Array.isArray(listed) ? listed : (listed?.emails ?? []);
    imageEmail = messages.find((email) => String(email.subject ?? "").includes(imageSubject)) ?? null;
    if (!imageEmail) await new Promise((done) => setTimeout(done, 3000));
  }
  assert(imageEmail && imageEmail.id, "the image-check message arrived in the inbox");
  await page.goto(`${MAILBOX_URL}/e/${encodeURIComponent(imageEmail.id)}`, { waitUntil: "networkidle2" });
  await harness.waitText(imageSubject, 30000);
  const relayed = await page
    .waitForFunction(
      () => (document.querySelector("iframe")?.getAttribute("srcdoc") ?? "").includes("data:image"),
      { timeout: 45000, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  assert(relayed, "the message image was relayed and inlined as a data: URL");
  await harness.shot("12-images");
  console.log("10c. message image relayed through get_image and inlined as a data: URL");
  await apiCall("delete_email", { mailboxId: MAILBOX, emailId: imageEmail.id });
  await apiCall("delete_email", { mailboxId: MAILBOX, emailId: imageEmail.id, permanent: true });

  // 10d. Wave-17 screens: every new surface renders against the live mailbox.
  await page.goto(`${MAILBOX_URL}/labels`, { waitUntil: "networkidle2" });
  await harness.waitText("Labels", 30000);
  await harness.waitAria("New label");
  await harness.shot("13-labels");
  console.log("10d. labels screen renders");

  await page.goto(`${MAILBOX_URL}/templates`, { waitUntil: "networkidle2" });
  await harness.waitText("Templates", 30000);
  await harness.waitAria("New template");
  await harness.shot("14-templates");
  console.log("10e. templates screen renders");

  await page.goto(`${MAILBOX_URL}/scheduled`, { waitUntil: "networkidle2" });
  await harness.waitText("Scheduled sends", 30000);
  await harness.shot("15-scheduled");
  console.log("10f. scheduled-sends screen renders");

  await page.goto(`${URL_BASE}/m`, { waitUntil: "networkidle2" });
  if (IS_APP_KEY) {
    await harness.waitText("Mailboxes", 30000);
    await harness.clickText(MAILBOX);
  }
  await harness.waitText("MANAGE", 30000);
  await harness.waitText("Scheduled sends", 30000);
  await harness.shot("16-manage");
  console.log("10g. mailbox home shows the Manage section");

  await page.goto(`${URL_BASE}/search?mailboxId=${encodeURIComponent(MAILBOX)}`, { waitUntil: "networkidle2" });
  await page.waitForSelector('input[placeholder^="Search this mailbox"]', { timeout: 30000 });
  await harness.shot("17-search");
  console.log("10h. search screen renders");

  const threadList = await apiCall("list_emails", { mailboxId: MAILBOX, folder: "inbox", limit: 20 });
  const threadRows = Array.isArray(threadList) ? threadList : (threadList?.emails ?? []);
  const threaded = threadRows.find((email) => typeof email.thread_id === "string" && email.thread_id);
  if (threaded) {
    await page.goto(`${MAILBOX_URL}/t/${encodeURIComponent(threaded.thread_id)}`, { waitUntil: "networkidle2" });
    await harness.waitText("in this thread", 30000);
    await harness.waitAria("Mute thread");
    await harness.waitAria("Summarize thread");
    await harness.shot("18-thread");
    console.log("10i. thread screen renders with mute/mark-read/summarize actions");
  } else {
    console.log("10i. no threaded message in the inbox; thread leg skipped");
  }

  await page.goto(`${MAILBOX_URL}/f/inbox`, { waitUntil: "networkidle2" });
  await harness.waitText("Appointment Confirmed", 30000);
  await harness.clickText("Appointment Confirmed");
  await harness.waitText("Appointment Confirmed", 30000);
  await harness.clickAria("More");
  await harness.waitText("Labels…", 20000);
  await harness.clickText("Labels…");
  await harness.waitText("Labels — tap to toggle", 20000);
  await harness.shot("19-label-sheet");
  console.log("10j. message More-sheet carries the Labels action and the label sheet opens");

  // 10k. All Accounts view: the merged listing, and its screen.
  if (IS_APP_KEY) {
    const merged = await apiCall("list_all_emails", { folder: "inbox", limit: 5 });
    assert(Array.isArray(merged?.emails), "list_all_emails answers a merged page");
    assert(
      typeof merged.totalCount === "number" && merged.totalCount >= 1,
      "list_all_emails counts every mailbox's inbox",
    );
    assert(
      merged.emails.length >= 1 && merged.emails.every((row) => typeof row.mailboxId === "string"),
      "every merged row carries its mailbox",
    );

    await page.goto(`${URL_BASE}/all`, { waitUntil: "networkidle2" });
    await harness.waitText("All Accounts", 30000);
    await harness.waitText("All Mail", 20000);
    await harness.clickText("Inbox");
    const firstSubject = merged.emails[0]?.subject;
    if (typeof firstSubject === "string" && firstSubject) {
      await harness.waitText(firstSubject, 30000);
    }
    await harness.shot("20-all-accounts");
    console.log("10k. All Accounts view merges every mailbox");
  } else {
    console.log("10k. All Accounts leg skipped (the merged listing needs a global key)");
  }

  // 11. Settings, then disconnect.
  await page.goto(`${URL_BASE}/m`, { waitUntil: "networkidle2" });
  await harness.waitText(IS_APP_KEY ? "Mailboxes" : MAILBOX, 20000);
  await harness.clickAria("Settings");
  await harness.waitText(KIND_LABEL, 20000);
  await harness.waitText("Secret");
  const preview = await page.evaluate(() => document.body.innerText);
  assert(!preview.includes(KEY), "the full key is never rendered");
  await harness.shot("12-settings");
  await harness.clickText("Disconnect");
  await harness.waitText("Disconnect?", 15000);
  await harness.clickText("Disconnect", { last: true });
  await harness.waitText("Agentic Inbox Codebam", 20000);
  const cleared = await page.evaluate(() => localStorage.getItem("agentic-inbox.session"));
  assert(cleared === null, "disconnect clears the stored key");
  await harness.shot("13-disconnected");
  console.log("11. settings shown; disconnect cleared the key");

  ok = report(harness, {
    // Step 2 deliberately drives one 401 with a bogus key, and the draft leg
    // refetches the just-discarded draft (400 Email not found) before its
    // screen unmounts. The hydration warning (#418) is intermittent on this
    // exported static build and React regenerates the tree itself.
    ignoreConsole: [/status of 401/, /status of 400/, /Minified React error #418/],
    ignoreResponses: [/POST 401 .*\/scoped\/list_emails/, /POST 400 .*\/scoped\/get_email/],
  });
  if (!ok) console.log("unexpected console/page errors above");
  console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
} catch (error) {
  ok = false;
  report(harness);
  console.error(`SMOKE FAILED: ${error.message}`);
  throw error;
} finally {
  await harness.close();
  await staticServer.close();
}
process.exit(ok ? 0 : 1);
