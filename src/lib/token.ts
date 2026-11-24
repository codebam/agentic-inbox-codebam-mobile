/**
 * Client-side parsing of Mailflare API keys.
 *
 * One wire shape now: an `ep_` key minted in the app under Settings → API
 * keys, with "Allow JMAP" ticked. The key authenticates the JMAP endpoint as
 * its user, so it reaches every mailbox that user can read — there is no
 * per-mailbox key kind to tell apart any more (the fork's `ain1_`/`ain2_`
 * tokens were scoped-token rows that stock Mailflare does not have).
 *
 * App passwords for IMAP/SMTP use the same `ep_` prefix and are accepted here
 * too, because JMAP's Basic authentication takes the same secret.
 */

export type TokenKind = "api";

export interface ParsedToken {
  kind: TokenKind;
  /** Always null: a key is per user, not per mailbox. */
  mailboxId: null;
}

/** `ep_` followed by the secret. Deliberately loose: the server is the judge. */
const API_KEY_PATTERN = /^ep_[A-Za-z0-9_-]{8,}$/;

/** Parse a pasted key, or null when it is not the shape Mailflare issues. */
export function parseToken(raw: string): ParsedToken | null {
  const token = raw.trim();
  if (!API_KEY_PATTERN.test(token)) return null;
  return { kind: "api", mailboxId: null };
}

/** A short, safe display form of a key: prefix + enough to recognize it, never the secret. */
export function tokenPreview(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 9)}…${trimmed.slice(-4)}`;
}
