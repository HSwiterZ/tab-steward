# Chrome Web Store submission copy (English)

Use this if you add an English listing in the store dashboard.

## Package

- Upload: `dist/tab-steward-1.0.0.zip`
- Version: `1.0.0`
- Rebuild: `npm run pack` (excludes `src/dev`, tests and screenshots)
- Minimum Chrome: 116

## Listing

- **Name**: Tab Steward
- **Summary (≤132 characters)**: Group tabs by site, then search, discard, stash and de-duplicate from one screen. Every module can be turned off. Data stays local.
- **Category**: Productivity
- **Language**: English
- **Homepage**: https://github.com/HSwiterZ/tab-steward
- **Support**: https://github.com/HSwiterZ/tab-steward/issues
- **Privacy policy**: https://hswiterz.github.io/tab-steward/privacy.html (live once GitHub Pages is enabled)
- **Visibility**: Unlisted — installable by link, not shown in store search
- **Regions**: All
- **Price**: Free

## Description

Tab Steward groups your open tabs by site so you can see at a glance how much is actually open.

What it does:

- **Site groups**: tabs from the same domain sit in one card with idle time, last visit and tab count.
- **One search (Ctrl/⌘ K)**: tabs, stashed pages, bookmarks, history and recently closed, in the same palette on the popup, Dashboard and new tab page.
- **Discard and wake**: auto-discard by idle time, or discard a tab or a whole group manually. Pinned, protected and active tabs are never touched.
- **Duplicates only prompt**: nothing is closed for you. The notification and banner offer “Close this and jump” and “Switch to the existing tab”, and the prompt clears itself after 10 seconds.
- **Collections and drag-and-drop**: dragging a tab into a collection stashes it without closing it; reorder inside a collection or across collections.
- **Snapshots and undo**: save a window layout and restore it later; bulk closes come with Undo.
- **Usage analytics**: foreground time, activation count and idle score, computed locally.
- **Reminders**: pick a target from your open tabs, get a notification on time, snooze when needed.
- **Inline Dashboard on the new tab page**: the Dashboard tile expands in place — no navigation, no new tab, the address stays the same.
- **Context menu**: tab actions and reminder entry from any page.
- **Module switches**: turn off what you do not use; its entry points and background work go away with it.

Privacy:

- No developer-operated server, no analytics, ads or crash reporting. Tabs, bookmarks, history, snapshots and settings stay on your machine.
- The only outbound request is the optional LLM organizer, off by default. It sends tab titles, domains, idle minutes and state to the endpoint you enter; no full URLs, bookmarks or history.
- The `<all_urls>` permission for hover screenshots is requested on demand, never granted implicitly, and can be revoked in settings.
- Full text in the privacy policy.

The interface is currently Chinese. Zero build, zero dependencies; source is MIT licensed on GitHub.

## Single purpose

Manage, search, discard and stash Chrome tabs in one place to keep tab clutter under control.

## Permission justifications

| Permission | Why it is needed |
| --- | --- |
| `tabs` | List, switch, move, discard and close tabs — the core of the product. |
| `tabGroups` | Read and adjust tab groups to organise by window or site. |
| `storage` | Save collections, snapshots, analytics, reminders, trash and settings locally. |
| `unlimitedStorage` | Snapshots and optional screenshots can exceed the default `storage.local` quota; data remains local. |
| `bookmarks` | Include bookmarks in unified search; read-only, never uploaded. |
| `history` | Include browsing history in unified search; read-only, never uploaded. |
| `sessions` | Show and restore recently closed tabs. |
| `notifications` | Reminders and duplicate-tab prompts. |
| `alarms` | Schedule reminders and idle-discard checks. |
| `favicon` | Show site icons through Chrome's `_favicon` endpoint. |
| `contextMenus` | Tab actions and reminder entry in the page context menu. |
| Optional host permission `<all_urls>` | Requested only when the user enables “tab hover screenshot”, for `chrome.tabs.captureVisibleTab`; revocable in settings. |

## Data disclosures

- **Collects or uses user data**: yes, processed locally, except the optional outbound request below.
- **Web history**: yes. Tab URLs/titles, bookmarks and history are read locally; the optional LLM organizer sends titles, domains, idle minutes and state only, never full URLs, bookmarks or history.
- **User activity**: yes. Activation counts and foreground time are measured locally for analytics.
- **Authentication information**: yes, only for the optional LLM organizer. The API key is entered by the user, stored locally and sent directly to the endpoint the user configures.
- **PII, location, financial, health, personal communications, website content**: no.
- **Sold**: no.
- **Used for credit, lending or insurance eligibility**: no.
- **Human review**: no, except for security, legal compliance or at the user's explicit request.
- **Encryption in transit**: local data is not transmitted; LLM requests go to the user's endpoint and are encrypted when it uses HTTPS.
- **Remote code**: no. All JavaScript is packaged; there is no `eval`, remote script or dynamic loading.

## Reviewer notes

- No account is needed. Click the toolbar icon for the popup; the Dashboard opens from the popup or with `Alt+Shift+T`.
- The new tab page is replaced with a minimal start page as part of the product. The Dashboard tile expands the full UI in place.
- The optional LLM organizer is off by default; every local feature is reviewable without configuring it.
- Hover screenshots stay off until the user grants the host permission in settings.

## Images

- Store icon: `assets/icon128.png` (128×128)
- Screenshots (1280×800, upload in this order):
  1. `store/screenshots/01-overview.png` — Dashboard overview
  2. `store/screenshots/02-dark.png` — dark theme
  3. `store/screenshots/03-analytics.png` — usage analytics
  4. `store/screenshots/04-search.png` — unified search
  5. `store/screenshots/05-popup.png` — toolbar popup
- Small promo tile: `store/promo-440x280.png` (440×280)
- Marquee and video: not uploaded (optional)
