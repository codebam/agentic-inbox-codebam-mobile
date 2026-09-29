# Agentic Inbox Codebam: mobile

An Expo (React Native) client for **Agentic Inbox Codebam**, the self-hosted email inbox on
Cloudflare Workers. Connect it with an access key and read, search, reply, manage drafts and triage mail
(star, move, delete, snooze, block, unsubscribe) from your phone, in Expo Go or as a
standalone build.

## What it is

This is the mobile companion app of the Agentic Inbox Codebam distribution. It talks to a
deployment's scoped automation API: every call is `POST /api/v1/scoped/<tool>` with a bearer key
that is either

- a **global key** (`ain2_...`, minted in the deployment's Global Settings, App access tokens),
  which reaches every mailbox, or
- a **scoped key** (`ain1_...`, minted in a mailbox's Settings, Access tokens), which reaches one
  mailbox.

The app detects the key kind from its shape, validates it against the server before storing it,
and keeps it in the device's secure storage.

## Features

- Mailbox picker (global key) or straight into the bound mailbox (scoped key)
- Folder browsing: Inbox, Sent, Drafts, Archive, Snoozed, Spam, Trash, with paging and pull to refresh
- Full-text search within a mailbox, or across every mailbox with a global key
- Message view: sanitized HTML rendering (no scripts, no remote images, locked by CSP), a plain
  text toggle, thread view, attachment metadata and text previews
- Reply and compose with an explicit confirmation before anything is sent, or save as a draft
- Draft editing and discarding
- Triage from the message view: star, read/unread, move between folders, snooze (with a wake
  action on snoozed mail), delete (Trash-aware, with a permanent delete from Trash), block or
  allow the sender, and one-click unsubscribe when the sender offers it (needs the `manage`
  scope; unsubscribe needs `send`)
- Multi-select in any folder list (long-press a message, or the Select button): batch mark read or
  unread, star, move, and delete
- Message images load through the deployment's `get_image` relay, so photos appear without the
  phone ever contacting the sender
- A Formatted / Plain text switch on every message, with an HTML-to-text fallback for messages
  that carry no text part
- Opening a message marks it read automatically

## Getting a key

In the inbox web UI:

1. **Global key**: Global Settings, then App access tokens, and mint a key with the scopes you need
   (`read`, `draft`, `send`, `manage`; `manage` unlocks the triage actions).
2. **Scoped key**: open a mailbox, Settings, then Access tokens.

The key is shown once at mint. Paste it into the app's Connect screen.

## Development

```sh
npm install
npm test                              # vitest: key parsing, API wire shape, HTML sanitizing, formatting
npm run typecheck                     # tsc --noEmit
npx expo lint
npx expo start                        # dev server
node scripts/make-assets.mjs          # re-render the icon set (icon, adaptive layers, splash, favicon)
```

On this host the dev server is reached from the phone over the tailnet:

```sh
EXPO_PACKAGER_HOSTNAME=100.101.46.50 npx expo start --port 8082
```

Then open Expo Go on the phone and load `exp://100.101.46.50:8082` (or scan the QR code). A web
build (`npx expo export --platform web`) is used for headless UI checks against a real deployment.

### Layout

- `src/app/`: expo-router routes (connect, mailboxes, folders, folder list, message, thread,
  search, compose, settings)
- `src/lib/`: `token.ts` (key parsing), `api.ts` (the scoped API client and its wire-shape rules),
  `queries.ts` (React Query hooks), `email-html.ts` (body sanitizing and message documents),
  `session.tsx`, `storage.ts`
- `src/components/`: shared UI pieces

## Security notes

- The key lives in the platform secure store (`expo-secure-store`); on web builds it falls back to
  localStorage, so use the web build for development only.
- Message bodies render in a JavaScript-disabled WebView (native) or a fully sandboxed iframe
  (web) under a `default-src 'none'` CSP: scripts never run, frames and forms are stripped, and
  every image is fetched by the deployment itself (the scoped `get_image` relay, behind the same
  SSRF guard and cache as the web client's image proxy) and inlined as a `data:` URL, so a
  sender's server only ever sees Cloudflare's egress, never the phone; an image that cannot be
  relayed stays a text placeholder.
- Links open in the system browser, never inside the message view.

## Provenance

Agentic Inbox Codebam is a modified fork of
[cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) (Apache-2.0). This app is
part of that distribution; it is not a component of the upstream project and is not affiliated
with, endorsed by, or sponsored by Cloudflare, Inc. The project starter is Expo's create-expo-app
template (MIT, see LICENSE).
