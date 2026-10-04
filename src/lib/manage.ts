/**
 * Manage-action helpers: pure logic for triage actions (move, snooze,
 * unsubscribe). Kept free of React Native imports so unit tests can run
 * them under plain Node.
 */

import { SYSTEM_FOLDERS, type FolderEntry } from "./format";

/** Triage destinations a message can be moved into, in menu order. */
const MOVE_IDS = ["inbox", "archive", "spam", "trash"] as const;

/** The move menu for a message in `currentFolder`: that folder is dropped. */
export function moveTargets(currentFolder: string): FolderEntry[] {
  const current = (currentFolder ?? "").toLowerCase();
  return SYSTEM_FOLDERS.filter(
    (folder) => (MOVE_IDS as readonly string[]).includes(folder.id) && folder.id !== current,
  );
}

export interface SnoozePreset {
  label: string;
  /** The `until` value the snooze tool takes: a shorthand or an ISO instant. */
  until: string;
}

/**
 * The snooze menu, computed from a caller-supplied clock (never the render
 * body) so the component stays render-pure. Morning presets use local 8:00.
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const morning = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 8, 0, 0, 0).toISOString();
  return [
    { label: "In 3 hours", until: "3h" },
    { label: "Tomorrow morning", until: morning(1) },
    { label: "Next week", until: morning(7) },
  ];
}

/**
 * The send-later menu for the composer, computed from a caller-supplied
 * clock (never the render body). Every entry is a future ISO instant — the
 * schedule_send tool refuses shorthands — so the first preset is computed
 * rather than reusing snooze's "3h" string.
 */
export function sendLaterPresets(now: Date): { label: string; sendAt: string }[] {
  const morning = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 8, 0, 0, 0).toISOString();
  return [
    { label: "In 3 hours", sendAt: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString() },
    { label: "Tomorrow morning", sendAt: morning(1) },
    { label: "Next week", sendAt: morning(7) },
  ];
}

/**
 * The one-click unsubscribe target a stored message advertises, mirroring
 * the server's own condition (an https `<...>` URL plus the RFC 8058
 * one-click marker). Null means the action is not offered; the server still
 * refuses at call time either way, so this only drives the menu.
 */
export function oneClickUnsubscribeTarget(email: {
  list_unsubscribe?: string | null;
  list_unsubscribe_post?: string | null;
}): string | null {
  const post = email.list_unsubscribe_post ?? "";
  if (!/^list-unsubscribe=one-click$/i.test(post.trim())) return null;
  const header = email.list_unsubscribe ?? "";
  for (const match of header.matchAll(/<([^>]+)>/g)) {
    const candidate = (match[1] ?? "").trim();
    if (/^https:\/\//i.test(candidate)) return candidate;
  }
  return null;
}
