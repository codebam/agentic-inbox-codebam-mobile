/**
 * Display formatting helpers. Pure string/date logic — no React Native
 * imports, so unit tests can run them under plain Node.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

/** List-row date: a time for today, "Sep 28" this year, "Sep 28, 2025" otherwise. */
export function formatEmailDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** Full timestamp for the message header: "Sun, Sep 28, 2026, 18:04". */
export function formatFullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${weekdays[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The display name of a raw address ("Ada <ada@x.test>" → "Ada"; else the address). */
export function senderName(raw: string | null | undefined): string {
  if (!raw) return "(unknown sender)";
  const trimmed = raw.trim();
  const named = /^"?([^"<]*?)"?\s*<[^>]*>$/.exec(trimmed);
  if (named?.[1]?.trim()) return named[1].trim();
  return trimmed;
}

/** The address part of a raw address field. */
export function senderAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  const match = /<([^>]*)>/.exec(raw);
  return (match?.[1] ?? raw).trim();
}

/** A single letter for the avatar circle. */
export function senderInitial(raw: string | null | undefined): string {
  const name = senderName(raw).trim();
  return name ? name.charAt(0).toUpperCase() : "?";
}

/** Ensure a reply subject carries exactly one "Re:" prefix. */
export function replySubject(subject: string | null | undefined): string {
  const trimmed = (subject ?? "").trim();
  if (!trimmed) return "Re:";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Truncate flat text at a word-ish boundary for previews. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Human file size for attachment chips. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FolderEntry {
  id: string;
  name: string;
}

/** The system folders every mailbox has, in sidebar order. */
export const SYSTEM_FOLDERS: readonly FolderEntry[] = [
  { id: "inbox", name: "Inbox" },
  { id: "sent", name: "Sent" },
  { id: "draft", name: "Drafts" },
  { id: "archive", name: "Archive" },
  { id: "snoozed", name: "Snoozed" },
  { id: "spam", name: "Spam" },
  { id: "trash", name: "Trash" },
];

export function folderDisplayName(id: string): string {
  const known = SYSTEM_FOLDERS.find((folder) => folder.id === id.toLowerCase());
  if (known) return known.name;
  return id.charAt(0).toUpperCase() + id.slice(1);
}
