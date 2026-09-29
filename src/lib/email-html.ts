/**
 * DOM-free helpers for email bodies.
 *
 * The phone never loads anything a sender controls: the document we render
 * carries a `default-src 'none'` CSP (only inline styles and data: images),
 * scripts/frames/forms are stripped, and every `<img>` becomes a small text
 * placeholder. Bodies are rendered inside a WebView (native) or sandboxed
 * iframe (web) with JavaScript disabled.
 */

/** Escape text for embedding in HTML; used for headers and composed bodies. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Decode the common named and numeric HTML entities for flat-text display. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Strip a body's HTML down to a one-paragraph preview (list snippets, titles). */
export function stripHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert composed plain text to the composer's canonical HTML shape: one
 * pre-wrap div, literal characters, `<br><br>` between paragraphs. This is
 * the shape the worker's verifyDraft keeps verbatim, so paragraph spacing
 * survives the draft/send pipeline.
 */
export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => escapeHtml(paragraph).replace(/\n/g, "<br>"));
  return `<div style="white-space:pre-wrap">${paragraphs.join("<br><br>")}</div>`;
}

/**
 * Sanitize a body for rendering: no scripts, frames, forms, metas or event
 * handlers; every image becomes a text placeholder (the phone deliberately
 * never fires a sender's tracking pixel).
 */
export function sanitizeEmailHtml(html: string): string {
  let out = html;
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
  out = out.replace(/<script\b[^>]*\/?>/gi, " ");
  for (const tag of ["iframe", "object", "embed", "form", "template", "noscript"]) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  out = out.replace(/<(meta|link|base|title)\b[^>]*>[\s\S]*?(<\/title\s*>)?/gi, (match) =>
    match.toLowerCase().startsWith("<title") ? " " : " ",
  );
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Script-bearing URL schemes never ride into the document. The CSP already
  // blocks them, but the safest attribute is one that cannot run at all.
  out = out.replace(
    /\s(href|xlink:href|src|action|formaction)\s*=\s*("|')?\s*(?:javascript|vbscript|data)\s*:[^"'\s>]*\2?/gi,
    ' href="#"',
  );
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = /alt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const label = (alt?.[1] ?? alt?.[2] ?? "").trim();
    return `<span class="ai-image">${escapeHtml(label ? `🖼 ${label}` : "🖼 image")}</span>`;
  });
  // A full document's structural tags are dropped; the content stays.
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(out);
  if (body?.[1] !== undefined) out = body[1];
  out = out.replace(/<\/?(html|head|body)\b[^>]*>/gi, " ");
  return out;
}

interface Palette {
  background: string;
  text: string;
  secondary: string;
  border: string;
  chip: string;
  tint: string;
}

const LIGHT: Palette = {
  background: "#ffffff",
  text: "#16181d",
  secondary: "#5b6069",
  border: "#e4e5e9",
  chip: "#f0f0f3",
  tint: "#2f6fdb",
};

const DARK: Palette = {
  background: "#0f1012",
  text: "#eceef2",
  secondary: "#a6abb5",
  border: "#2e3135",
  chip: "#212225",
  tint: "#6ba6f8",
};

function documentCss(palette: Palette): string {
  return `
*, *::before, *::after { box-sizing: border-box; max-width: 100%; }
body { margin: 0; padding: 0; background: ${palette.background}; color: ${palette.text};
  font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  font-size: 15px; line-height: 1.5; word-break: break-word; overflow-wrap: anywhere; }
header.ai-head { padding: 14px 16px 12px; border-bottom: 1px solid ${palette.border}; }
header.ai-head h1 { margin: 0 0 8px; font-size: 19px; line-height: 1.35; font-weight: 650; }
header.ai-head .ai-meta { color: ${palette.secondary}; font-size: 13px; line-height: 1.5; }
header.ai-head .ai-meta b { color: ${palette.text}; font-weight: 600; }
main.ai-body { padding: 14px 16px 24px; }
main.ai-body img { display: none; }
span.ai-image { display: inline-block; padding: 1px 8px; border-radius: 6px;
  background: ${palette.chip}; color: ${palette.secondary}; font-size: 13px; }
a { color: ${palette.tint}; }
blockquote { margin: 8px 0 8px 4px; padding-left: 12px; border-left: 2px solid ${palette.border}; color: ${palette.secondary}; }
table { width: auto !important; }
pre, code { white-space: pre-wrap; word-break: break-word; }
`;
}

export interface EmailDocumentInput {
  subject?: string | null;
  sender?: string | null;
  recipient?: string | null;
  cc?: string | null;
  /** Pre-formatted display date. */
  date?: string | null;
  folderName?: string | null;
  /** The message body's HTML (or "" when a body has no HTML form). */
  bodyHtml: string;
  scheme: "light" | "dark";
}

/**
 * Build the full document a WebView/iframe renders: CSP meta first (so no
 * remote subresource can ever load), then a header block, then the sanitized
 * body. The document is self-contained — it has no scripts and no network.
 */
export function buildEmailDocument(input: EmailDocumentInput): string {
  const palette = input.scheme === "dark" ? DARK : LIGHT;
  const subject = input.subject?.trim() || "(no subject)";
  const metaRows: [string, string][] = [];
  if (input.sender) metaRows.push(["From", input.sender]);
  if (input.recipient) metaRows.push(["To", input.recipient]);
  if (input.cc) metaRows.push(["Cc", input.cc]);
  if (input.date) metaRows.push(["Date", input.date]);
  if (input.folderName) metaRows.push(["Folder", input.folderName]);
  const metaHtml = metaRows.map(([label, value]) => `<div><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</div>`).join("");
  const body = input.bodyHtml.trim() ? sanitizeEmailHtml(input.bodyHtml) : `<p style="color:${palette.secondary}">(no content)</p>`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none';">
<style>${documentCss(palette)}</style>
</head>
<body>
<header class="ai-head">
<h1>${escapeHtml(subject)}</h1>
<div class="ai-meta">${metaHtml}</div>
</header>
<main class="ai-body">${body}</main>
</body>
</html>`;
}
