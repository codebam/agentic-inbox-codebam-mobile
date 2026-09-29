/**
 * Client-side parsing of agentic-inbox access tokens.
 *
 * Mirrors `shared/access-tokens.ts` in the agentic-inbox repo. Two wire
 * shapes exist, told apart by their prefixes:
 *
 *     ain1_<hex of the mailbox id's UTF-8 bytes>_<43-char base64url secret>
 *         one mailbox — minted in a mailbox's Settings → Access tokens
 *     ain2_<43-char base64url secret>
 *         every mailbox — minted in Global Settings → App access tokens
 *
 * The two parsers are deliberately disjoint: a near miss is refused, never
 * guessed at.
 */

export type TokenKind = "mailbox" | "app";

export interface ParsedToken {
  kind: TokenKind;
  /** The mailbox the key is bound to; null for a global (app) key. */
  mailboxId: string | null;
}

const MAILBOX_TOKEN_PATTERN = /^ain1_((?:[0-9a-f]{2})+)_([A-Za-z0-9_-]{43})$/;
const APP_TOKEN_PATTERN = /^ain2_([A-Za-z0-9_-]{43})$/;

/**
 * Decode lowercase hex back to a string, or null when the bytes are not
 * valid UTF-8 — the same fatal-decoder semantics the worker's hexToUtf8
 * uses, so a key with a mangled mailbox segment is refused on both ends.
 */
export function hexToUtf8(hex: string): string | null {
  try {
    return decodeURIComponent(hex.replace(/../g, "%$&"));
  } catch {
    return null;
  }
}

/** Parse a pasted key into its kind and mailbox, or null when it is neither shape. */
export function parseToken(raw: string): ParsedToken | null {
  const token = raw.trim();
  const mailbox = MAILBOX_TOKEN_PATTERN.exec(token);
  if (mailbox) {
    const hex = mailbox[1];
    if (hex === undefined) return null;
    const mailboxId = hexToUtf8(hex);
    return mailboxId === null ? null : { kind: "mailbox", mailboxId };
  }
  if (APP_TOKEN_PATTERN.test(token)) return { kind: "app", mailboxId: null };
  return null;
}

/** A short, safe display form of a key: prefix + enough to recognize it, never the secret. */
export function tokenPreview(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 9)}…${trimmed.slice(-4)}`;
}
