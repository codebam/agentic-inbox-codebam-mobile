#!/usr/bin/env node
/**
 * Render the app's icon set from one SVG design: the store/launcher icon, the
 * Android adaptive foreground, background and monochrome layers, the splash
 * glyph and the web favicon. Screenshots the design through the same
 * Chromium the E2E harness uses, so no image library is needed.
 *
 *   node scripts/make-assets.mjs
 *
 * The glyph (envelope + agent spark) sits inside the adaptive-icon safe zone
 * so no mask shape clips it; the launcher icon and favicon add the brand
 * gradient behind it.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

import { CHROMIUM } from "./e2e-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "images");

/** Brand colour; app.json's adaptiveIcon/splash background matches it. */
const BRAND = "#2f6fdb";

/** The envelope + agent spark, drawn inside the adaptive safe zone. */
const GLYPH = `
  <rect x="252" y="332" width="520" height="360" rx="56" fill="none" stroke="#ffffff" stroke-width="52"/>
  <path d="M282 370 L512 556 L742 370" fill="none" stroke="#ffffff" stroke-width="52" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M692 210 L702 240 L732 250 L702 260 L692 290 L682 260 L652 250 L682 240 Z" fill="#ffffff"/>
`;

const GRADIENT = `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b7be8"/><stop offset="1" stop-color="#2456b8"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#bg)"/>`;
const FLAT = `<rect width="1024" height="1024" fill="${BRAND}"/>`;

function svg(size, { background = "", glyph = GLYPH }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">${background}${glyph}</svg>`;
}

const targets = [
  { file: "icon.png", size: 1024, alpha: false, markup: svg(1024, { background: GRADIENT }) },
  { file: "android-icon-foreground.png", size: 1024, alpha: true, markup: svg(1024, {}) },
  { file: "android-icon-background.png", size: 1024, alpha: false, markup: svg(1024, { background: FLAT, glyph: "" }) },
  { file: "android-icon-monochrome.png", size: 1024, alpha: true, markup: svg(1024, {}) },
  { file: "splash-icon.png", size: 1024, alpha: true, markup: svg(1024, {}) },
  { file: "favicon.png", size: 64, alpha: false, markup: svg(64, { background: FLAT }) },
];

const browser = await puppeteer.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  for (const target of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: target.size, height: target.size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!DOCTYPE html><style>html,body{margin:0;padding:0}</style><body>${target.markup}</body>`,
    );
    const buffer = await page.screenshot({ type: "png", omitBackground: target.alpha });
    writeFileSync(join(OUT, target.file), buffer);
    console.log(
      `wrote assets/images/${target.file} (${target.size}px${target.alpha ? ", alpha" : ""}, ${buffer.length} bytes)`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
