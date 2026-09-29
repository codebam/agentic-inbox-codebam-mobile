/**
 * Shared helpers for the headless browser checks: a tiny static server for an
 * Expo web export plus puppeteer-core plumbing against the system Chromium.
 *
 * These scripts run on the host shell (Chromium is at the path below), not in
 * the sandbox.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import puppeteer from "puppeteer-core";

export const CHROMIUM = process.env.E2E_CHROMIUM ?? "/etc/profiles/per-user/codebam/bin/chromium";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

function resolveFile(distDir, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(distDir, clean), join(distDir, `${clean}.html`), join(distDir, clean, "index.html")];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  // SPA fallback for extension-less paths (client-side routing takes over).
  if (!extname(clean)) return join(distDir, "index.html");
  return null;
}

export function startStaticServer(distDir, port) {
  const server = createServer((req, res) => {
    const file = resolveFile(distDir, req.url ?? "/");
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({
        close: () => new Promise((done) => server.close(() => done())),
      }),
    );
  });
}

export async function startHarness({ profileSuffix, beforeBoot }) {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", `--user-data-dir=/tmp/chrome-${profileSuffix}-${Date.now()}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900 });

  const consoleErrors = [];
  const badRequests = [];
  const badResponses = [];
  const shots = [];

  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    if (!failure.includes("ERR_ABORTED")) badRequests.push(`${failure} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.request().method()} ${response.status()} ${response.url()}`);
  });

  if (beforeBoot) await beforeBoot(page);

  const harness = {
    page,
    consoleErrors,
    badRequests,
    badResponses,
    shots,
    async shot(name) {
      const path = `/tmp/e2e-${name}.png`;
      await page.screenshot({ path });
      shots.push(path);
      console.log(`  shot: ${path}`);
    },
    async waitText(text, timeout = 20000) {
      await page.waitForFunction((needle) => document.body.innerText.includes(needle), { timeout, polling: 250 }, text);
    },
    async waitGone(text, timeout = 20000) {
      await page.waitForFunction((needle) => !document.body.innerText.includes(needle), { timeout, polling: 250 }, text);
    },
    async waitAria(label, timeout = 15000) {
      await page.waitForFunction(
        (ariaLabel) =>
          [...document.querySelectorAll(`[aria-label="${ariaLabel}"]`)].some((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }),
        { timeout, polling: 250 },
        label,
      );
    },
    async clickText(text, clickOptions = {}) {
      const clicked = await page.evaluate(
        (needle, last) => {
          // Only VISIBLE elements count: stack navigation keeps earlier
          // screens in the DOM and their copies of the same text would
          // otherwise win the "shortest text" race.
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          const all = [...document.querySelectorAll("div,span,a,button,label,p")].filter(
            (el) => (el.textContent ?? "").includes(needle) && visible(el),
          );
          if (all.length === 0) return false;
          const best = Math.min(...all.map((el) => (el.textContent ?? "").length));
          const minimal = all.filter((el) => (el.textContent ?? "").length === best);
          const target = last ? minimal[minimal.length - 1] : minimal[0];
          if (!target) return false;
          const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, detail: 1 };
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
            const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
            target.dispatchEvent(new Ctor(type, eventInit));
          }
          return true;
        },
        text,
        clickOptions.last ?? false,
      );
      if (!clicked) throw new Error(`No visible element found containing text: ${text}`);
    },
    async clickAria(label) {
      const clicked = await page.evaluate((ariaLabel) => {
        // Stack navigation keeps earlier screens in the DOM, so several
        // elements can carry the same label: click the first VISIBLE one.
        const node = [...document.querySelectorAll(`[aria-label="${ariaLabel}"]`)].find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (!node) return false;
        const eventInit = { bubbles: true, cancelable: true, composed: true, view: window, detail: 1 };
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
          node.dispatchEvent(new Ctor(type, eventInit));
        }
        return true;
      }, label);
      if (!clicked) throw new Error(`No visible element with aria-label: ${label}`);
    },
    async typeInto(selector, text) {
      await page.waitForSelector(selector, { timeout: 15000 });
      await page.click(selector);
      await page.type(selector, text, { delay: 4 });
    },
    async close() {
      await browser.close();
    },
  };
  return harness;
}

export function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

export function report(harness, options = {}) {
  const ignoreConsole = options.ignoreConsole ?? [];
  const ignoreResponses = options.ignoreResponses ?? [];
  const expectedConsole = harness.consoleErrors.filter((line) => ignoreConsole.some((pattern) => pattern.test(line)));
  const expectedResponses = harness.badResponses.filter((line) => ignoreResponses.some((pattern) => pattern.test(line)));
  const consoleErrors = harness.consoleErrors.filter((line) => !expectedConsole.includes(line));
  const badResponses = harness.badResponses.filter((line) => !expectedResponses.includes(line));

  if (consoleErrors.length > 0) {
    console.log("console/page errors seen:");
    for (const line of consoleErrors) console.log(`  - ${line}`);
  }
  if (harness.badRequests.length > 0) {
    console.log("failed requests seen:");
    for (const line of harness.badRequests) console.log(`  - ${line}`);
  }
  if (badResponses.length > 0) {
    console.log("non-2xx responses seen:");
    for (const line of badResponses) console.log(`  - ${line}`);
  }
  if (expectedConsole.length > 0 || expectedResponses.length > 0) {
    console.log("expected non-2xx (excused by this journey):");
    for (const line of [...expectedConsole, ...expectedResponses]) console.log(`  ~ ${line}`);
  }
  return consoleErrors.length === 0 && harness.badRequests.length === 0;
}
