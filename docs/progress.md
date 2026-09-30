# Progress

Spec: `specs/sidekick-mvp.md`. Status values: todo / in progress / done.

## T01 Scaffold and toolchain

Status: done (2026-09-30, orchestrator). Owner loaded both builds on their desktop without errors, and the sidebar opened. The close-on-second-click check is deferred to the owner's end-of-MVP test.

### Plan

- Add `package.json` (WXT 0.20.x, TypeScript strict, Preact, Vitest + happy-dom + @testing-library/preact, ESLint flat config + typescript-eslint, Prettier, web-ext, Playwright) with scripts `lint`, `typecheck`, `test`, `build` (both targets), `build:chrome`, `build:firefox`, `lint:firefox`, `e2e`.
- `wxt.config.ts`: per-target manifest (Chrome `side_panel` + `sidePanel`; Firefox `sidebar_action`, `open_at_install: false`), only the permissions needed so far (decision T01-4), `optional_host_permissions: ["<all_urls>"]`, `default_locale: "en"`, minimum versions.
- `public/_locales/{en,de}/messages.json` with extension name/description and the sidebar heading.
- `src/entrypoints/background.ts`: Chrome `setPanelBehavior`, Firefox `action.onClicked` -> `sidebarAction.toggle()`.
- `src/entrypoints/sidepanel/`: Preact root with the localised "Browser Sidekick" heading.
- Tests: manifest snapshot per target (exact permission lists), sidebar root smoke component test.
- CI: add `lint:firefox` step to `.github/workflows/ci.yml`.
- Record Firefox `optional_host_permissions` and minimum-version findings in `docs/decisions.md`.
- Open questions: none so far.

### Acceptance

- [x] Both builds load unpacked without manifest warnings (owner desktop, both browsers; orchestrator: Firefox 140 headless `web-ext run` installs cleanly). Chrome: loaded headless in Chromium, side panel page renders. Firefox: not loaded yet (no Firefox on the runner); `web-ext lint` has 0 errors and 2 warnings (`UNSAFE_VAR_ASSIGNMENT` from Preact, decisions.md T01-8; `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, Android only, decisions.md T01-16). Orchestrator checks both browsers.
- [~] Clicking the icon opens the sidebar in both browsers (owner). Closing on a second click is deferred to the owner's end-of-MVP test. Needs the orchestrator's manual check.
- [x] The gate passes on CI (draft PR #1, self-hosted runner). Passes locally on the runner machine; the CI run needs the branch pushed (owner approval).
- [x] The heading renders in German when the browser UI language is German. Component test renders with the `de` messages; the German string is "Browser Sidekick", identical to English. Browser check by the orchestrator.

### Tests

- `tests/manifest.test.ts`: snapshot and exact permission lists per target.
- `tests/sidepanel-app.test.tsx`: sidebar root smoke test in `en` and `de`.
- `tests/locales.test.ts`: `en` and `de` have the same keys, no empty messages.

## T02 Storage layer and data model

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, CI green, Firefox 140 load OK)

### Plan

- Add `idb` (runtime, spec section 6) and `fake-indexeddb` (dev, spec section 6).
- `src/shared/model.ts`: `Session` (`providerId`, `model`, `titleSource`), `Pin`, `Message` (with `MessageSource[]`), `ProviderConfig`, `Settings`, and their unions.
- `src/shared/db/schema.ts`: `sidekick` DB, schema version 1 (`sessions` by `updatedAt`, `pins` and `messages` by `sessionId`), and a migration hook that runs one step per version.
- `src/shared/db/repository.ts`: session, pin and message CRUD, sessions listed by `updatedAt`, cascade delete, delete-all; adding a pin or message bumps `updatedAt` in the same transaction.
- `src/shared/settings.ts`: settings store over `storage.local` only (one key per field, defaults, change listener, reset for Delete all data).
- Manifest: add `storage` to both targets (decision T01-4) and update the snapshot test.
- Tests: repository on `fake-indexeddb`, migration hook, settings store on `fakeBrowser`, sync storage never called, API key never in IndexedDB.
- Open questions: none so far.

### Acceptance

- [x] All repository functions are covered by tests (`tests/repository.test.ts`: every `Repository` method; `tests/db-schema.test.ts`: schema v1 and the migration hook; `tests/settings.test.ts`: every settings function).
- [x] Cascade delete leaves no orphan pins or messages (tested by dumping all stores after `deleteSession`; `deleteAll` empties every store).
- [x] Keys are only ever written to `storage.local` (tests: the key appears only in `storage.local.set` calls, never in `storage.session` or IndexedDB; `storage.sync` spies never called; source scan finds no sync storage use).

### Tests

- `tests/repository.test.ts`: repository unit tests on `fake-indexeddb`.
- `tests/db-schema.test.ts`: schema version 1, migration hook (ordering, async steps, failing step, versionchange).
- `tests/settings.test.ts`: settings store on `fakeBrowser`, sync storage never called, key never in IndexedDB.
- `tests/manifest.test.ts`: `storage` added to both permission lists and snapshots.

## T03 Sidebar shell and session management

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, CI green incl. e2e, orchestrator reviewed light/dark screenshots)

### Plan

- `src/shared/sessions.ts` (tests first): resolve the active session on open (stored id, else most recent, else create one), new-session input from the default provider, delete with the "next active" rule of spec 5.2.
- `src/shared/i18n.ts`: message keys typed from `en/messages.json`, substitutions; new strings in `en` and `de`.
- Sidebar UI (`src/entrypoints/sidepanel/`): header (drawer button, title with inline rename, New session, settings gear), sessions drawer (switch, delete with confirmation, relative time, pin count), empty Session tabs (collapsible, state remembered), empty transcript, disabled Summarize, disabled input with a settings link, minimal settings view (filled by T05). Neutral CSS with light and dark.
- The sidebar opens one repository in `main.tsx` and passes it to `App`.
- Component tests: header, rename, drawer (switch, delete confirm, delete active), keyboard paths.
- Playwright harness in `tests/e2e/` loading `dist/chrome-ext`; flow: create, rename, switch, delete, survive extension reload and browser restart; screenshots `test-results/screens/T03-*.png` (light, plus dark). CI step `npm run e2e`.
- Open questions: none so far.

### Acceptance

- [x] The sessions list behaves per spec 5.2: sorted by last activity with title, relative time and pin count; click switches; delete asks for confirmation and removes the session with its pins and messages (`tests/sidepanel-drawer.test.tsx`, `tests/sessions.test.ts`, e2e).
- [x] The active session survives a browser restart (e2e: extension reload and a second launch on the same profile; `storage.local` + IndexedDB).
- [x] Deleting the active session switches to the most recent remaining one, or to a new empty session (component tests, unit tests, e2e).
- [x] Everything is keyboard-operable: native buttons, rename via Enter/Escape, drawer focus management with `inert`, Escape closes the drawer or cancels a delete, settings refocus (component tests; e2e drives rename, drawer navigation, switch and delete cancel by keyboard).
- [x] All strings are in both locales (`tests/locales.test.ts`; `de` render test).
- [x] The orchestrator has looked at the build in both browsers (screenshots in `test-results/screens/T03-*.png`).

### Tests

- `tests/sessions.test.ts`: active-session resolution, new-session provider/model, activate, delete with the next-active rule.
- `tests/sidepanel-app.test.tsx`: root layout in `en`/`de`, first run, stored active session, load error, Session tabs collapse state and count, Summarize tooltip, disabled input and settings link.
- `tests/sidepanel-header.test.tsx`: header controls, New session, settings, inline rename (Enter, blur, Escape, empty/unchanged, save error, no double save).
- `tests/sidepanel-drawer.test.tsx`: order and meta, focus and Escape, switch, delete confirm and cancel, delete other, delete active, delete last, renamed titles.
- `tests/relative-time.test.ts`: relative time in `en` and `de`.
- `tests/e2e/sessions.spec.ts`: create, rename, switch, delete; survives extension reload and browser restart; deleting the only session.

## T04 LLM provider adapters

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, CI green, Firefox 140 load OK)

### Plan

- `src/shared/llm/types.ts`: `LlmProvider` (`listModels(signal?)`, `stream(request, signal)` yielding text deltas, `mapError(error)`), `LlmRequest` (model, system, turns, optional max output tokens), `LlmError` with a small code set (invalid key, rate limit/quota, model not found, context too long, bad request, server, network, aborted, unknown). No UI strings; T05/T10 localise the codes.
- `src/shared/llm/sse.ts` (tests first): byte stream to SSE events; chunks split mid-event and mid-character, CRLF/CR/LF, comments, missing trailing blank line, bare JSON lines for lenient OpenAI-compatible servers.
- `src/shared/llm/errors.ts` (tests first): HTTP status + provider error body to `LlmError`; key redacted and message length-capped.
- Adapters `openai.ts`, `anthropic.ts`, `gemini.ts` and a `createProvider(config)` factory; `fetch` injectable, default `globalThis.fetch`.
- OpenAI-compatible: `/models` missing or odd -> free-text fallback; unknown event fields ignored; non-streamed JSON reply tolerated.
- Manifest: the three provider `host_permissions` from spec 6 on both targets (decision T01-4); update manifest test and snapshots.
- Tests (mocked `fetch` only, a guard fails any unmocked call): per adapter request shape, stream parsing incl. split chunks, abort, 401/429/404/400/network mappings, `listModels` success and fallback, key only in its own auth header.
- Record doc versions/dates relied on in `docs/decisions.md`.
- Open questions: none so far.

### Acceptance

- [x] The adapters stream, abort and map errors correctly against mocked `fetch` (`tests/llm-adapters.test.ts` contract per adapter; `tests/llm-openai.test.ts`, `tests/llm-anthropic.test.ts`, `tests/llm-gemini.test.ts`).
- [x] The key only appears in the auth header of its own provider (contract test on stream and model-list calls: not in URL, body or other headers; Anthropic and Gemini ignore the stored base URL; the key is redacted from provider messages).
- [x] No real network calls are made in tests (`fetch` injected as a mock; the global `fetch` is stubbed to throw in every LLM test file).

### Tests

- `tests/llm-sse.test.ts`: SSE framing, chunks split mid-event and mid-character, CRLF split across chunks, comments, missing final blank line, bare JSON lines.
- `tests/llm-errors.test.ts`: status and body mapping per provider, key redaction, message cap, in-stream payloads, thrown values.
- `tests/llm-openai.test.ts`, `tests/llm-anthropic.test.ts`, `tests/llm-gemini.test.ts`: request shape, stream parsing at many chunk sizes, provider-specific events and errors, `listModels` success, pagination and fallback.
- `tests/llm-adapters.test.ts`: per adapter 401/403/429/404/400/500/network mappings, broken stream, abort mid-stream / while waiting / while pending / pre-aborted, key placement, `listModels` fallbacks and abort, default global `fetch`, `mapError`.
- `tests/manifest.test.ts`: provider `host_permissions` on both targets.

## T05 Provider settings UI

Status: done (2026-09-30; gate-checker PASS, CI green incl. e2e, orchestrator reviewed screenshots; Firefox permission prompts deferred to docs/owner-checklist.md)

### Plan

- `src/shared/providers.ts` (tests first): origin match pattern per provider (Chrome with port, Firefox without: MDN says Firefox patterns can't carry a port), masked key, default-provider normalisation (one usable default whenever a usable provider exists), header model options, session provider fallback after deletion, form validation.
- `src/shared/provider-access.ts`: `permissions.contains` / `request` for custom origins and, per the orchestrator's T04-10 decision, the three native hosts too; `syncProviderAccess` refreshes the stored `hasAccess` on open and on `permissions.onAdded/onRemoved`; "Grant access" requests one host from the click.
- `src/shared/llm-messages.ts`: localised text per `LlmError` code (reused by T10); `providerMessage` shown only redacted and capped, never logged.
- Settings view: provider list (default badge, no-access badge with Grant access, make default, edit, delete with confirmation), provider form per kind (kind, label, base URL editable for OpenAI-compatible only, key masked `••••last4` after save, model dropdown from `listModels` with free-text fallback, context budget, Ollama/LM Studio help), Test connection (1-token request), permission request on save from the click, Delete all data with the providers box.
- Header model dropdown (D15, custom listbox so it is keyboard-operable and screenshot-able); a session on a deleted provider falls back to the default with a one-line notice.
- Tests: component tests for the form per kind, masking, permission request granted/denied (exactly one request), default provider, model dropdown, deletion fallback, delete-all, input disabled until usable provider.
- `tests/mock-llm/`: Node OpenAI-compatible server (`/v1/models`, streaming `/v1/chat/completions`, key check, scripted errors, request log) with its own test; e2e adds a provider pointing at it, tests invalid and valid keys, picks a session model, deletes all data. Mock origin granted by seeding the Chromium profile's `Preferences` (no build change). Screens `test-results/screens/T05-*.png`.
- Open questions: none so far.

### Acceptance

- [x] A provider of each kind can be added, tested, made default, edited and deleted (component tests per kind for add, validation, edit, Make default, delete with confirmation; Test connection success and mapped errors with a stubbed `fetch`; e2e adds, tests with a wrong and a right key, edits and deletes via Delete all data against the mock server). Anthropic and Gemini are never contacted in tests.
- [x] New sessions start on the default provider and model (component test with two providers; e2e New session shows the default model).
- [x] Changing a session's model affects only that session (component test checks both sessions in IndexedDB; e2e switches back to the first session).
- [x] Deleting a provider moves its sessions to the default, with the notice (component tests: the active session at once, another session when opened, and the no-provider-left notice; decisions.md T05-5).
- [x] The key is never rendered after save (component tests search the whole DOM for the key in the list and the edit form; e2e checks the page HTML; the field shows `••••last4` as text only).
- [x] A custom origin triggers exactly one permission request (component tests: one request when granted, one when declined, none when already covered; Grant access requests one host).
- [x] Delete all data empties IndexedDB and, when ticked, the providers too (component tests for both, and Cancel; e2e with the box ticked).
- [x] The input is disabled until a usable provider exists (component tests: no provider, a no-access provider, then access granted; e2e before and after).
- [x] The orchestrator has looked at the build in both browsers (screens in `test-results/screens/T05-*.png`, light and dark).

### Tests

- `tests/providers.test.ts`: origin patterns (Chrome with port, Firefox without), native hosts, masking, default normalisation, header model groups, session model resolution, form validation.
- `tests/provider-access.test.ts`: contains/request, declined and refused requests, access sync incl. revoked native host, permission events, provider writes keep one usable default, localised LLM errors.
- `tests/sidepanel-settings.test.tsx`: provider form per kind, masking, host access (granted, declined, refused, covered, Grant access, revoked on open), default provider, Test connection and model list, session model dropdown (mouse and keyboard), provider deletion fallback, Delete all data, input state.
- `tests/mock-llm.test.ts`: the mock server against the real OpenAI-compatible adapter.
- `tests/e2e/providers.spec.ts`: provider flow against the mock server; screens `T05-01` to `T05-11`.

## T06 Page access and generic extraction

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, CI green incl. e2e, Firefox 140 load OK, orchestrator reviewed screenshots)

### Plan

- Manifest: add `activeTab` and `scripting` to both targets (decision T01-4, orchestrator); no `tabs`. Update manifest test and snapshots.
- `src/shared/restricted.ts` (tests first): restricted-URL check per browser (non-http(s) schemes incl. `view-source:`, `file:`, other extensions' pages; Chrome Web Store, Firefox restricted Mozilla domains).
- `src/shared/extract/` (tests first): pure `extractFromDocument(doc)` (Readability on a clone, clean block text, `innerText` fallback, 200k cap without splitting a surrogate pair); dispatcher `extractTab(tabId, url)` with a kind registry (generic page now; YouTube/PDF slots for T08/T09) and failure reason codes; unlisted script `extract-page` injected via `scripting.executeScript({ files })`. Add `@mozilla/readability` (spec 6).
- `src/shared/page-access.ts`: all-sites check, banner request and per-site request (D10), both called synchronously from the click; site pattern per URL.
- `src/shared/current-tab.ts`: tracker over `tabs.onActivated`/`onUpdated`, `windows.onFocusChanged` and permission events; active tab of the last focused normal window; states readable / restricted / not accessible from what host permissions and activeTab reveal.
- Sidebar: access banner (Allow on all sites, Dismiss; hidden once granted, dismissed or declined), a plain current-tab row in Session tabs (needle and eye are T07).
- Tests: extractor fixtures (article, non-article, huge), restricted table, dispatcher, tracker, banner component tests. e2e with a localhost fixture server: not-granted (banner, dismiss, not accessible) and all-sites granted (tracker follows tab and window switches, injected extractor returns text); screens `T06-*`.
- Open questions: none so far.

### Acceptance

- [x] The banner shows until access is granted or dismissed (component tests: first open, granted from the click, declined/refused counts as the one ask, Dismiss persists across reopen, grant and revoke from outside, German; e2e: shown without access, dismissed, still gone after reload; hidden with the all-sites grant). The real browser prompt is on the owner checklist.
- [x] Restricted pages are recognised (`tests/restricted.test.ts` table per browser; dispatcher refuses them without injecting; current-tab row "This page can't be read").
- [x] Extraction returns clean text for article fixtures and falls back correctly (`tests/extract-page.test.ts`: article via Readability without nav/ads/footer/scripts, non-article via `innerText`, empty page, huge article and huge fallback capped at 200,000 and marked truncated; e2e runs the built injected script on the article fixture).
- [x] The current tab updates when switching tabs or windows (`tests/current-tab.test.ts`: activation, navigation, window focus, access changes, re-read during a read; e2e: tab switch, navigation, new window and back). Clicking between two windows in a headed browser is on the owner checklist (headless Chromium doesn't move focus).
- [x] Follow-up (orchestrator): the Page access section in Settings lets the user grant all-sites access after the banner is gone, and the "not accessible" row has a hint that links to it (`tests/sidepanel-access.test.tsx`; e2e screen `T06-04-settings-page-access`).
- [x] The orchestrator has looked at the build in both browsers (screens `test-results/screens/T06-*.png`).

### Tests

- `tests/restricted.test.ts`: restricted-URL table (Chrome and Firefox), site patterns.
- `tests/extract-page.test.ts`: extractor on fixtures (article, non-article, empty, huge -> truncated), cap without splitting a surrogate pair.
- `tests/extract-dispatch.test.ts`: injection, restricted, no-access (Chrome and Firefox wording), unreadable, malformed result, empty, extractor registry.
- `tests/extract-messages.test.ts`: localised failure reasons.
- `tests/page-access.test.ts`: all-sites and per-site checks and requests (synchronous, declined, refused, non-web URLs).
- `tests/current-tab.test.ts`: classification table, reading, watching.
- `tests/sidepanel-access.test.tsx`: banner component tests, current-tab row.
- `tests/manifest.test.ts`: `activeTab` and `scripting` on both targets.
- `tests/e2e/page-access.spec.ts`: without access and with the all-sites grant; screens `T06-01-banner`, `T06-02-banner-dismissed`, `T06-03-granted`, `T06-04-settings-page-access` (each also `-dark`).

## T07 Pinning and pinned-pages list

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, CI green incl. e2e, Firefox 140 load OK, orchestrator reviewed screenshots; duplicate race T07-5 accepted for the MVP)

### Plan

- Manifest: `contextMenus` on both targets (decision T01-4, orchestrator). Firefox 140's `contextMenus` namespace imports the full `menus` schema incl. the `tab` context (checked in its `omni.ja` and MDN), so no `menus` permission. Update manifest test and snapshots.
- `src/shared/messages.ts` (tests first): the typed message union and runtime guard (spec 6 "Messaging"): `pin-tab` and `refresh-pin` (sidebar -> background, with a response), `pins-changed` and `already-pinned` (broadcasts to every sidebar). This is the live-sync protocol for T03-12; later tasks reuse it.
- `src/shared/pins.ts` (tests first): URL normalisation (fragment stripped), duplicate check, pin orchestration (add `extracting` -> extractor dispatcher -> `ready` / `failed` with reason), first-pin fallback title only while `titleSource` is `fallback`, refresh; restricted pages refused. Dependencies injected (repository, extractor, broadcast).
- `src/shared/open-tabs.ts`: open tabs by normalised URL (visible URLs only, no `tabs`), focus-or-open (reused by T10 citations), watcher for the Refresh button.
- `src/shared/context-menu.ts` + background: "Pin to Sidekick" (Chrome `page`, `frame`; Firefox also `tab`), created on install; click pins into the active session; message handlers for the sidebar.
- Sidebar: pinned rows (favicon, title, domain, kind badge, status, truncated, failure reason; open, refresh when open, unpin), current-tab row with needle (calls `requestSiteAccess` first in the click when `siteAccess` is false, D10) and eye toggle (reset on tab switch), the pinned current tab shown once, "Already pinned" notice with Refresh, live updates from broadcasts. Strings in `en` and `de`.
- Tests: messages guard, pin orchestration (success, failure, duplicate, refresh, restricted, title rule), context-menu handler on `fakeBrowser`, open tabs, Session tabs component tests (pinned rows, current-tab row, pinned current tab, unreadable tab, collapse, eye, needle with and without site access, live update).
- e2e: needle pin with extracting -> ready (slow fixture page), second pin, duplicate via the menu listener, failed pin, refresh, unpin, eye, collapse, context-menu pin with the sidebar closed; screens `T07-*`. Check headless whether `openPanelOnActionClick` grants activeTab, else owner checklist.
- Open questions: none so far.

### Acceptance

- [~] Pinning works from the page context menu in both browsers, from the Firefox tab strip, and from the current-tab needle, with the sidebar open and with it closed (the needle only with it open). Chrome: e2e fires the real menu listener with the sidebar open (duplicate) and closed (new pins, incl. a first run with no session), and the needle pins in the e2e. Firefox: the same handler with the `tab` context is unit-tested (`tests/pin-service.test.ts`), and the Firefox build installs cleanly in Firefox 140. Real right-clicks in both browsers and the tab strip are on the owner checklist (Playwright can't open context menus; spec T07 Tests).
- [x] Duplicates are prevented (fragment ignored): unit tests (`tests/pins.test.ts`, `tests/pin-service.test.ts`), component tests ("Already pinned" with Refresh and Dismiss), e2e via the menu listener.
- [x] Failed pins show their reason (unit: `failed` with reason code, extractor throwing; component: localised reason; e2e: empty page shows "No readable text was found on this page.").
- [x] The list reflects status changes live (broadcast protocol, decisions.md T07-3; component tests for background and other-session messages; e2e: extracting -> ready on a held-back page, and a menu pin with the sidebar open).
- [x] The current tab appears once, whether pinned or not, and the eye toggle resets on tab switch (component tests incl. a pinned URL with a different fragment; e2e counts and marker; eye resets after switching tabs and back, and stays on navigation within the tab).
- [x] The orchestrator has looked at the build in both browsers (screens `test-results/screens/T07-*.png`).

### Tests

- `tests/messages.test.ts`: message and outcome guards, broadcast without a receiver, request replies.
- `tests/pins.test.ts`: URL normalisation, pin orchestration (extracting -> ready, failed, extractor error, kind, duplicate, other session, restricted, unknown session, URL title, pin deleted mid-extraction), first-pin fallback title, refresh (success, failure keeps text, unknown pin).
- `tests/pin-service.test.ts`: menu contexts per browser, registration and German title, menu click (active session, no session yet, Firefox tab strip, page URL fallback, duplicate broadcast, other items, hidden URL, restricted), pin and refresh requests, message listener guard, service wiring on `fakeBrowser`.
- `tests/open-tabs.test.ts`: visible tabs, matching without fragment, focus or open, watcher.
- `tests/sidepanel-session-tabs.test.tsx`: current-tab row, unreadable tabs, eye toggle and reset, needle (extracting -> ready, failed, D10 site request first in the click, already granted, refused, background unreachable), pinned rows (fields, order, Refresh only when open, refresh, open, unpin), pinned current tab, "Already pinned", live updates, collapse, German.
- `tests/manifest.test.ts`: `contextMenus` on both targets.
- `tests/e2e/pinning.spec.ts`: needle, extracting -> ready, failed, duplicate via the menu listener, refresh, unpin, eye, collapse, menu pin with the sidebar closed; screens `T07-01` to `T07-07`.

## T08 YouTube transcript extractor

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, CI green incl. e2e, Firefox 140 load OK, orchestrator reviewed screenshot; live Firefox check on owner checklist)

### Plan

- Spike (live, local only, throwaway Playwright profile, not signed in): on public videos with and without captions, try (a) the caption track `baseUrl` from the player response, (b) the transcript panel in the DOM, (c) InnerTube `get_transcript` with the page's own client context; also how to get a fresh player response after in-app navigation. Record per-method results and the choice in decisions.md.
- `src/shared/extract/youtube.ts` (tests first): URL detection (`watch`, `youtu.be`, `shorts`, `m.`/`www.`), video id; pure parsers for the chosen payloads (track choice: page language, else first), plain text with `[mm:ss]` markers every ~30 s, fallback text (title + description + "No transcript available" note), 200k cap.
- Injected MAIN-world function via `scripting.executeScript({ world: 'MAIN', func })` that returns untrusted raw data; validated and parsed in the extension. Register the YouTube extractor before the page extractor in `EXTRACTORS`.
- Tests: detection URL table, parsers on trimmed synthetic fixtures (`tests/fixtures/youtube/`), dispatcher wiring. e2e: fixture watch pages served at youtube.com URLs by Playwright request interception (decisions.md T08-11), screen `T08-01-youtube-pin`.
- Owner checklist line: pin a real video with and without captions in both browsers. No new permissions, no new dependencies.
- Open questions: none so far.

### Acceptance

- [x] A video with captions yields its transcript, including after in-app navigation from another video. Unit: `[mm:ss]` blocks from the fixture panel; the tab URL's video is fetched afresh while the page globals are stale; language choice. e2e: fixture video pinned Ready with the YouTube badge and the transcript text, then `pushState` navigation. Live (spike, Chromium, `en` and `de`): real captioned videos, and a related video reached in-app (decisions.md T08-4). Firefox live is on the owner checklist.
- [x] A video without captions yields the fallback (title, description, "No transcript available.", kind YouTube): unit (also when the panel request fails or is empty, German note), e2e, and live.
- [x] Shorts are handled: detection table, unit extraction through the watch page, e2e (a fixture Short), live (a real Short with captions).
- [x] Pins of YouTube URLs use the extractor through the dispatcher, and the row shows the "YouTube" badge (e2e, screen `T08-01-youtube-pin`).
- [x] No new permission or dependency; CI and e2e never contact YouTube.

### Tests

- `tests/youtube.test.ts`: detection URL table (watch, `m.`, bare host, `youtu.be`, Shorts, and non-video YouTube URLs), JSON assignment reader, watch-page parser (captions, none, legacy params ignored, chapter chip, untrusted values), language choice, InnerTube context, timestamps, panel parser (malformed, deep input), text format, fallback.
- `tests/youtube-extractor.test.ts`: the MAIN-world functions against a fake YouTube origin, the extractor end to end (transcript, page language, first track, minimal context, fallback incl. failed panel, in-app navigation, Shorts and `youtu.be`, wrong video, malformed results, no access, 200k cap), dispatcher order and badges.
- `tests/e2e/youtube.spec.ts`: captioned video, in-app navigation to a video without captions, a Short; screens `T08-01-youtube-pin` (light and dark).
