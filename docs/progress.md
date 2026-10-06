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
- [x] Follow-up (D17, owner decision 2026-10-01): a context-menu pin also opens the sidebar, synchronously in the click (`sidePanel.open` in Chrome, `sidebarAction.open` in Firefox), and a sidebar that is just opening still shows "Already pinned" (`tests/pin-service.test.ts`, `tests/messages.test.ts`, `tests/sidepanel-session-tabs.test.tsx`, `tests/e2e/pinning.spec.ts`; decisions.md T07-18 to T07-20). No manifest change. The real right-click in both browsers is on the owner checklist.

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

## T09 PDF extractor

Status: done (2026-09-30; gate-checker PASS-WITH-NOTES, npm audit clean, CI green incl. e2e, Firefox 140 load OK, orchestrator reviewed screenshots; real-viewer checks on owner checklist)

### Plan

- Dependency `pdfjs-dist` `~5.5.207` (spec 6; newest release that supports the runner's Node 20 and isn't in advisory GHSA-hq66-cqwq-w95j). Legacy build (Chrome 116). Worker shipped as a packaged extension file via a WXT build hook; no CDN, no CSP change, `isEvalSupported: false`.
- Manifest: Chrome-only `offscreen` (decision T01-4, orchestrator). Update manifest test and snapshots.
- `src/shared/extract/pdf.ts` (tests first): detection (path ends in `.pdf`, `Content-Type: application/pdf`), the size-limited re-fetch (Content-Length first, stream aborted past 30 MB, no credentials), text extraction with pdf.js injected (pages in order, 200k cap), reason codes `pdf-too-large`, `pdf-encrypted`, `pdf-no-text`, `pdf-unreadable`, plus `no-access`.
- Runner: Chrome service worker -> offscreen document (`src/entrypoints/offscreen/`) over a new `pdf-extract` request in `src/shared/messages.ts`; Firefox background page runs pdf.js itself.
- Dispatcher: PDF extractor before the generic page extractor for `.pdf` URLs (no `executeScript` on the viewer). Other URLs: if the page extractor fails, one re-fetch checks the Content-Type and reads the PDF only if it is `application/pdf`.
- Failure messages in `en` and `de`.
- Tests: fixture PDFs (text, encrypted, image-only; generated by a committed script), detection table, fetch limit, extraction, runner and messages, dispatcher. e2e: fixture PDFs from the localhost server pinned via the menu listener; screens `T09-01-pdf-pins` (+ `-dark`).
- Owner checklist: pin a real PDF from Chrome's and Firefox's built-in viewers.
- Open questions: none so far.

### Acceptance

- [x] A text PDF pins with its text. Unit: both pages in order with the metadata title (`tests/pdf.test.ts`), through the offscreen path and the dispatcher (`tests/pdf-extractor.test.ts`). e2e: the fixture PDF in Chromium's viewer, pinned with the needle, Ready with the PDF badge and its text; also a PDF behind a URL without `.pdf` (Content-Type). Firefox 140 headless: the same PDFs from Firefox's pdf.js viewer through the background page (decisions.md T09-13).
- [x] Scanned, encrypted or oversized PDFs fail with the right reason: `pdf-no-text`, `pdf-encrypted`, `pdf-too-large` with their localised texts (unit on the fixture PDFs, Content-Length and stream limits; e2e for all three; Firefox for the first two).
- [~] It works from both the Chrome and Firefox PDF viewers: Chromium headless viewer (e2e) and Firefox 140 ESR headless viewer (BiDi check) pass. Real PDFs in both desktop browsers, the context menu inside the viewers, and a pin without "Allow on all sites" are on the owner checklist (decisions.md T09-6).
- [x] The worker is a packaged file, no CDN or remote code, no CSP change (manifest test); Chrome-only `offscreen` permission, manifest snapshot updated.
- [x] Extracted text is never logged; failure reasons are codes, localised in `en` and `de`.

### Tests

- `tests/pdf.test.ts`: detection by URL and by Content-Type (tables), the reply guard, download (no credentials or referrer, Content-Length over 30 MB, stream cut past the limit, exactly the limit, failed request, HTTP error, error page when the type is required, abort), extraction on the fixture PDFs (text, encrypted, image-only, not a PDF, cap, safe load options, abort), the time limit.
- `tests/pdf-extractor.test.ts`: the PDF extractor (result, reasons, `no-access` vs `pdf-unreadable`, probe), registry order and badges, localised messages (en, de), the offscreen listener, and Chrome's offscreen path through the dispatcher with fixture PDFs (no script injected, document created and closed, shared by queued jobs, reused, Content-Type probe, no probe after success or for restricted pages).
- `tests/messages.test.ts`: the `pdf-extract` request guard.
- `tests/manifest.test.ts`: Chrome `offscreen`, no CSP key, `offscreen.html` only in the Chrome build, `pdf.worker.js` in both.
- `tests/e2e/pdf.spec.ts`: text, encrypted, image-only and Content-Type PDFs from the viewer, the 31 MB PDF through the menu listener; screens `T09-01-pdf-pins`, `T09-02-pdf-too-large` (each also `-dark`).

## T10 Chat: ask flow

Status: done (2026-10-01; gate-checker PASS-WITH-NOTES for the task and for the hardening follow-up, CI green incl. e2e, Firefox 140 load OK after the background change, orchestrator reviewed screenshots)

### Plan

- Dependencies `marked` and `dompurify` (spec 6, approved).
- `src/shared/chat/context.ts` (tests first): context assembly per spec 5.6 (system instructions, ready pins in Session tabs order with delimiters, index, title and URL, the current tab labelled with the next index, history as user/assistant pairs, the question), sources list, budget (chars ÷ 4; oldest history pairs dropped first, then page texts trimmed proportionally), `trimmed` flag.
- `src/shared/chat/markdown.ts` (tests first): `marked` -> DOMPurify (DOM fragment) -> citation links for `[n]` with a matching source (outside code and links), other links `target=_blank rel="noopener noreferrer"`, only http(s)/mailto hrefs.
- `src/shared/chat/title.ts` (tests first): one title request with the first question and the first 2,000 characters of the answer; cleaned to at most 6 words; applied with `setSessionTitle(..., 'llm')`, so the repository guard keeps a `user` title (race-safe); failures silent.
- `src/shared/chat/current-tab-text.ts`: the current tab extracted on demand at send time via the dispatcher; PDFs read by pdf.js in the sidebar itself on both browsers (not Chrome's offscreen document); used for the request only.
- Messages: broadcasts `messages-changed` and `title-changed` (ids only) in `src/shared/messages.ts`.
- Sidebar: chat hook (send, stream, stop, retry; one request per session; streaming lives in the sending sidebar), Transcript (user messages, sanitised Markdown answers, citations via `focusOrOpen`, Stop, stopped mark, trimming and current-tab notices, error with Retry, auto-scroll), Composer (Enter sends, Shift+Enter newline, the "no access" state with Grant access). Strings in `en` and `de`.
- Tests: context/budget, sanitiser/citations, title (success, failure, rename race), ask-flow component tests with a mocked provider (stream, stop, error, retry, history restore, exclusion, provider/model). Mock LLM request log used as is (it already scripts slow, hanging and error replies).
- e2e `tests/e2e/chat.spec.ts` against the mock LLM with the orchestrator's 8 steps; screens `T10-*`.
- Open questions: none. Q6 (write the two test files) and Q7 (store the error code) were answered by the owner on 2026-10-01; the plan changed accordingly: a failed answer is stored with `Message.error` instead of staying in memory.

### Acceptance

- [x] Questions are answered using the pins and the current tab: the request carries each ready pin and then the current tab between delimiters, with index, title and URL (unit: `tests/chat-context.test.ts`; component: `tests/sidepanel-chat.test.tsx`; e2e on the mock's request log, by booleans only). A PDF current tab is read in the sidebar (e2e).
- [x] Excluding the current tab removes it from the request (component and e2e: text, label and second delimiter absent; the tab isn't even read). A current tab that is already pinned is sent once, as the pin.
- [x] Trimming shows the notice: oldest history first, then page texts proportionally (unit); the notice on the answer, stored with it (component, e2e, screen `T10-05`).
- [x] Stop keeps the partial answer, marked "Stopped" (component, e2e, screen `T10-03`).
- [x] History restores when switching sessions, and after a sidebar reload (component, e2e).
- [x] Citations lead to the right tab or URL, and keep working after unpinning: `[n]` uses the answer's stored source list (unit: `tests/chat-markdown.test.ts`; component: focus an open tab, open a closed page, no pin present; e2e: `[1]` focuses the article's tab, by click, Ctrl-click and keyboard).
- [x] The title is generated once, after the first answer, and never overwrites a manual rename (unit: `tests/chat-title.test.ts` incl. a rename during the request; component; e2e: one title request in the whole flow, screen `T10-06`).
- [x] Requests go to the session's provider and model (component; e2e: `mock-large`, then `mock-small` after the header dropdown, with the provider's key).
- [x] Follow-up (gate-checker): model output can't forge a citation (no `data-*`, `aria-*`, classes or buttons survive; `[[1]](url)` is an external link); genuine citations are buttons without an address, made from the stored sources; an answer with link, image, frame, style and media payloads causes no request (unit, component, e2e in Chromium; decisions.md T10-17 to T10-20).
- [x] Injected `<script>`/`onerror` in model output does not execute (unit and component under the DOM shim; e2e in real Chromium: no `script` or `img` in the transcript, the flag stays unset).
- [x] Errors appear inline with Retry; a failed answer is stored with its error code, so the error and Retry survive a reload, and a successful Retry clears it (owner decision Q7; repository, component and e2e tests, screen `T10-04`).
- [x] The input shows the provider's "no access" state with Grant access instead of sending (component).
- [x] New strings are in `en` and `de` (`tests/locales.test.ts`).
- [x] The orchestrator has looked at the build in both browsers (screens `test-results/screens/T10-*.png`). Firefox wasn't loaded in this task: no manifest or background change. Real providers and Firefox are on the owner checklist.

### Tests

- `tests/chat-context.test.ts`: ordering, delimiters, numbering by row, non-ready pins, no pages, forged delimiters, history pairs, trimming order and proportion, nothing fits, surrogate pairs, which current tab is sent.
- `tests/chat-markdown.test.ts`: Markdown shape, link attributes, sanitiser (script, handlers, `javascript:`, frames, forms, SVG, images), citation linking (single, groups, unknown numbers, code and links untouched, stored sources, non-web sources).
- `tests/chat-title.test.ts`: request content, title cleaning, first-answer rule, success, failure, empty reply, already renamed, rename during the request, deleted session, runaway reply.
- `tests/chat-current-tab.test.ts`: page, PDF by URL and by Content-Type through the sidebar runner, unreadable, restricted, extractor error.
- `tests/sidepanel-chat.test.tsx`: stream with stored answer, sources and title; manual rename kept; Shift+Enter and busy; Stop; error with Retry (cleared on success, kept after reopening, new code after a failed Retry, provider message, partial text, no Retry on an older failure); eye, pinned current tab, unreadable tab; trimming notice; history restore, session switch, citations, stored history sent, a message from another sidebar; no-access input (granted, declined).
- `tests/repository.test.ts`: the `error` field on add and update. `tests/messages.test.ts`: the two new broadcasts.
- `tests/e2e/chat.spec.ts`: the ask flow (8 steps plus trimming, long conversation and the reload after an error) and a PDF current tab; screens `T10-01-streaming`, `T10-02-answer` (+ `-dark`), `T10-03-stopped`, `T10-04-error-retry`, `T10-05-trimmed`, `T10-06-title`, `T10-07-long-scroll`.

## T11 Summarize

Status: done (2026-10-01; gate-checker PASS-WITH-NOTES, CI green incl. e2e, orchestrator reviewed screenshots)

### Plan

- `src/shared/chat/summarize.ts` (tests first): the D4 page set (ready pins, plus the current tab if readable, not excluded and not already pinned), built on `requestCurrentTab`; the button state (`ready`, or why not: no provider, provider without access, an answer on its way, nothing to summarise).
- `src/entrypoints/sidepanel/chat/useChat.ts`: `summarize(tab)` runs the T10 ask flow with the fixed prompt and `kind: 'summarize'` (question and answer); Retry keeps the kind; the title request works when it is the first answer. A pin still extracting when the button is pressed is waited for briefly, shown in the transcript; after the wait it is left out with a notice.
- `ActionBar`: the wired button; while unavailable it stays focusable (`aria-disabled`) with a tooltip per reason, drawn by the page so it shows on hover, on keyboard focus and in screenshots. `Transcript`: the live "Summarize" question and the two new notices.
- Strings in `en` and `de`: the fixed prompt (spec 5.6, in the UI language), the tooltips, the waiting line and the left-out notice.
- Tests: page-set table test (`tests/chat-summarize.test.ts`: pins only, current tab only, both, current tab already pinned, current tab excluded, failed and extracting pins, unreadable tab, nothing); component tests for the button states and the flow (`tests/sidepanel-summarize.test.tsx`: request per combination, stream, Stop, error with Retry, title, German prompt, waiting for a pin).
- e2e `tests/e2e/summarize.spec.ts` against the mock LLM: disabled on an empty session (tooltip), one pin plus the current tab (request log by booleans only), the current tab excluded, Summarize as the first action with the generated title; screens `T11-*`.
- No manifest, background, message-protocol or stored-data-shape change.
- Open questions: none so far.

### Acceptance

- [x] The page set matches D4 in every combination: pins only, current tab only, both, current tab already pinned, and current tab excluded. Table test (`tests/chat-summarize.test.ts`, also failed and extracting pins, unreadable tabs, nothing; each row is checked against the sources `assembleContext` sends), component tests on the request for each combination (`tests/sidepanel-summarize.test.tsx`), e2e on the mock's request log for both and for excluded.
- [x] Output streams into the transcript: a "Summarize" user message, then the streamed answer with Markdown, citations and Stop (component, e2e, screens `T11-02`, `T11-03`).
- [x] The fixed prompt is in the UI language (`en`, `de`): per-page summaries, then an overall summary with common themes and disagreements (component tests for both languages, e2e).
- [x] The button is disabled with a tooltip when there is nothing to summarise, when no usable provider exists (none, or without access) and while an answer streams; a click then sends nothing (component, e2e, screens `T11-01`, `T11-02`, `T11-06`).
- [x] Reuses the ask flow: trimming notice, Stop keeps the partial summary, a stored error with Retry that survives a reload, the summary as history of later questions, the title when it is the first answer (component; e2e for the title, screen `T11-04`).
- [x] A pin still extracting is waited for (10 s), visibly; after that it is left out with a notice (unit, component; decisions.md T11-4).
- [x] New strings are in `en` and `de` (`tests/locales.test.ts`).
- [x] No manifest, background, message-protocol or stored-data-shape change; no new dependency.
- [x] The orchestrator has looked at the build in both browsers (screens `test-results/screens/T11-*.png`).

### Tests

- `tests/chat-summarize.test.ts`: the page-set table (12 rows), the button state, the wait for extracting pins (none, ready in time, time limit, Stop).
- `tests/sidepanel-summarize.test.tsx`: button states and tooltips (ready, nothing, failed and extracting pins on a browser page, the eye, a pin turning ready, no provider, no access, streaming a summary, streaming a question, German); the request per D4 combination; the flow (message, stream, stored kinds and sources, title, reload), history, Stop, error with Retry after a reload, trimming notice, German prompt; the wait (included, left out with the notice, Stop).
- `tests/sidepanel-app.test.tsx`: the first-run button state, updated for the new tooltip.
- `tests/e2e/summarize.spec.ts`: the flow of decisions.md T11-8; screens `T11-01-disabled-tooltip` (+ `-dark`), `T11-02-streaming`, `T11-03-summary` (+ `-dark`), `T11-04-first-action-title` (+ `-dark`), `T11-05-current-tab-excluded`, `T11-06-empty-session-disabled`.

# Thinking levels

Spec: `specs/thinking-levels.md` (GitHub issue #4). Branch `feature/thinking-levels`. Status values as above.

## T13 LLM layer: thinking level in requests and capability discovery

Status: done (2026-10-01; gate-checker PASS-WITH-NOTES)

### Plan

- `src/shared/model.ts`: `ThinkingLevel`, `ModelInfo`, optional `ProviderConfig.modelInfo` (spec 5); re-exported from `src/shared/llm/types.ts`, which gains `LlmRequest.thinking?: { level, info }`, `ModelList` with per-model `info`, and the `thinking-unsupported` code.
- First a test that pins today's request bodies as exact strings for all three adapters, committed before any source change, so "byte-identical without thinking information" is proven against the old code.
- `listModels` per adapter (tests first): Anthropic `capabilities` and `max_tokens`, Gemini `thinking`, OpenAI-compatible `supported_parameters`; `listOrFallback` carries the info.
- Request mapping per adapter (tests first, table-driven, one row per row of spec 4.3), incl. Anthropic `max_tokens` and budget rules.
- `errors.ts`/`http.ts`: a 400/422 on a request that sent a level and whose message matches `/reasoning|thinking|effort/i` maps to `thinking-unsupported`; `llm-messages.ts` shows the generic bad-request string until T15.
- `ProviderForm`: keep `modelInfo` next to the loaded model list, write it on save, clear it wherever the list is cleared; component test.
- Callers and fakes of `listModels` updated (`tests/chat-title.test.ts`, `tests/mock-llm.test.ts`).
- No UI change, no locale string, no stream-interface change (T14), no manifest or dependency change.
- Open questions: none so far.

### Acceptance

- [x] Requests without thinking information produce byte-identical bodies to before, for all three adapters (`tests/llm-request-bodies.test.ts`, committed before the source changed and still passing unchanged).
- [x] Every row of the three mapping tables in 4.3 produces exactly the stated body fields, including the Anthropic `max_tokens` and budget rules (`tests/llm-thinking.test.ts`, whole-body comparisons).
- [x] `listModels` reports support per 4.2 for each adapter (`tests/llm-model-info.test.ts`), and the settings code stores it in `modelInfo` next to `cachedModels` (`tests/sidepanel-settings.test.tsx`, `tests/settings.test.ts`).
- [x] A 400 that mentions reasoning, thinking or effort on a request with a level maps to `thinking-unsupported`; the same 400 on a request without a level maps as before (`tests/llm-thinking.test.ts`, unit and per adapter).
- [x] No UI change, no locale string, no stream-interface change, no manifest or dependency change.

### Tests

- `tests/llm-request-bodies.test.ts`: the exact body strings without thinking information (7 rows over the three adapters).
- `tests/llm-thinking.test.ts`: the mapping tables per adapter (Anthropic 16 rows, Gemini 17, OpenAI-compatible 10 on four hosts); Anthropic `max_tokens` (cap below, at and above 32000, unknown cap, unknown model, caller limit, no thinking parameter) and budget (12 rows: lowered, left alone, dropped, caller limit); `thinking-unsupported` in `errorFromResponse` and per adapter, with and without a level.
- `tests/llm-model-info.test.ts`: per adapter supported, unsupported, unknown and malformed capability data.
- `tests/sidepanel-settings.test.tsx`: `modelInfo` stored on save, kept, replaced by a reload, cleared when loading fails or the base URL changes, not invented for older providers. `tests/settings.test.ts`: the storage round trip.
- `tests/provider-access.test.ts`: the error text for the new code. Existing `listModels` expectations updated for the new shape.

## T14 LLM layer: reasoning in the stream

Status: done (2026-10-01; gate-checker PASS-WITH-NOTES)

### Plan

- `src/shared/llm/types.ts`: `LlmStreamEvent = { type: 'text'; delta } | { type: 'reasoning'; delta }` (orchestrator decision); `LlmProvider.stream` returns `AsyncIterable<LlmStreamEvent>`.
- Adapters (tests first, replacing the "thinking is dropped" tests): Anthropic `thinking_delta` (nothing for `signature_delta` or empty thinking), Gemini `thought: true` parts, OpenAI-compatible `delta.reasoning_content` or `delta.reasoning` when a non-empty string; events in arrival order.
- Callers: title generation and Test connection read text events only; `tests/helpers/llm-fetch.ts` keeps `collect` (text) and gains `collectEvents`; the fakes in `tests/chat-title.test.ts` and `tests/mock-llm.test.ts` follow.
- `src/shared/model.ts`: `Message.reasoning?: string | null` (spec 5); the repository takes it on add and update, without a DB version bump.
- `useChat`: `LiveAnswer.reasoning` grows with the reasoning events, next to the partial text (T16 renders it); stored on completion, Stop and failure; a Retry replaces it. Nothing renders it yet.
- `tests/mock-llm/server.ts`: a scripted stream reply can carry reasoning chunks, under either field name; replies without them are unchanged.
- Tests: per-adapter stream tests (reasoning only, interleaved, both OpenAI field names, non-string reasoning), ask-flow tests (stored on completion, Stop, failure, Retry; not in the next request's turns, not in the budget), a title test, a repository test, a mock-server test.
- `docs/decisions.md`: T04-8 superseded with a dated entry; the mock trigger recorded.
- No dependency, manifest, locale or README change; nothing passes thinking information yet (T15).
- Open questions: none so far.

### Acceptance

- [x] Each adapter yields reasoning and text events in arrival order and yields nothing for signatures or empty reasoning (`tests/llm-anthropic.test.ts`, `tests/llm-gemini.test.ts`, `tests/llm-openai.test.ts`).
- [x] Title generation and Test connection behave as before: reasoning events don't reach the title (`tests/chat-title.test.ts`), a reasoning-only reply is a successful test with the unchanged request body (`tests/sidepanel-settings.test.tsx`), and the byte-identical body tests of T13 still pass unchanged.
- [x] The stored assistant message carries the reasoning on completion, Stop and failure, and a successful Retry replaces it (`tests/sidepanel-chat.test.tsx`, `tests/repository.test.ts`).
- [x] Reasoning is absent from the turns sent on the next request and from the context-budget calculation (`tests/sidepanel-chat.test.tsx`, `tests/chat-context.test.ts`).
- [x] Decision 8 of T04 in `docs/decisions.md` is superseded with a dated entry (T14-2).
- [x] While an answer streams, the reasoning that arrived is in the live answer next to the partial text (`LiveAnswer.reasoning`); nothing renders it yet.
- [x] The mock LLM sends reasoning deltas only for a scripted reply that asks for them, under either field name (`tests/mock-llm.test.ts`).
- [x] No dependency, manifest, locale or README change; reasoning is never logged or sent anywhere.

### Tests

- `tests/llm-anthropic.test.ts`, `tests/llm-gemini.test.ts`, `tests/llm-openai.test.ts`: reasoning then text for any chunking, reasoning only, interleaved, signatures, empty and non-string reasoning, reasoning kept before an in-stream error; OpenAI-compatible also both field names, both in one chunk, and the non-streamed JSON reply.
- `tests/sidepanel-chat.test.tsx` (`reasoning`): the live state through `useChat`; stored on completion, on Stop (with and without answer text) and on failure; Retry replaces or clears it; no reasoning in the next request, the title request, the broadcasts or the console.
- `tests/chat-context.test.ts`: reasoning outside the turns, the system text and the budget. `tests/repository.test.ts`: add, update, clear, assistant messages only.
- `tests/chat-title.test.ts`: reasoning events don't leak into the title or its runaway limit. `tests/sidepanel-settings.test.tsx`: Test connection with a reasoning-only reply.
- `tests/mock-llm.test.ts`: scripted reasoning over the wire and through the adapter; none without it.

## T15 Thinking-level control in the session header

Status: done (2026-10-01; gate-checker PASS-WITH-NOTES)

### Plan

- `src/shared/model.ts`: `Session.thinkingLevel?: ThinkingLevel | null` (spec 5); the repository takes it in `updateSession`; a new session doesn't get the field (Default). Repository test first, incl. records without the field.
- `src/shared/thinking.ts` (tests first): the model's info via `Object.hasOwn` (T13-3), whether the control shows (provider and model set, support not `unsupported`), and the `thinking: { level, info }` of a request (`level` is `null` while the control is hidden).
- `useChat`: Ask and Summarize (and their Retry) put that `thinking` on the request, also at Default; title generation and Test connection stay without it.
- `ThinkingMenu.tsx`: the `ModelMenu` listbox pattern and styling, in the header after the model menu; button "Thinking: <value>", options Default, Low, Medium, High. `style.css`: both menus in one group; the thinking control wraps below the model menu when they don't fit.
- `llm-messages.ts`: its own key for `thinking-unsupported`, no provider text. Strings of spec 4.7 for the control and the error in `en` and `de`.
- `tests/mock-llm/server.ts`: `reasoningEfforts` (one entry per chat request), a designated model id that answers 400 naming `reasoning_effort` when one is sent, and model-list entries that can carry `supported_parameters`.
- Tests: `tests/thinking.test.ts`, `tests/repository.test.ts`, `tests/sidepanel-thinking.test.tsx` (control: options, selection, persistence, hidden states, keyboard, both locales, while an answer streams; ask flow: level and info on the request for all three provider kinds, hidden sends none, title and Test connection never), `tests/mock-llm.test.ts`, `tests/provider-access.test.ts` (error text).
- e2e `tests/e2e/thinking.spec.ts`: set High, ask, the mock got `reasoning_effort: "high"`; new session at Default; switch back; reload; reject flow, then Default and Retry; hidden for an `unsupported` model; screens `T15-*` incl. a narrow width with a long model name.
- README Features line. No manifest, permission or dependency change.
- Open questions: the model menu has no disabled state today, so "follows the model menu's rules" (spec 4.1) leaves the control enabled while an answer streams; the spec's example assumes otherwise. Recorded in decisions.md, raised in the report.

### Acceptance

- [x] The control shows the session's level, changes it, and the change persists across reopening the side panel and switching sessions (`tests/sidepanel-thinking.test.tsx`, `tests/repository.test.ts`; e2e incl. a reload; screens `T15-02`, `T15-03`, `T15-04`).
- [x] A new session starts at Default: the record has no level (`tests/repository.test.ts`, component, e2e).
- [x] The control is hidden with no provider or model and for an `unsupported` model, shown for `supported` and `unknown`; a hidden control sends no level and keeps the stored one (`tests/thinking.test.ts`, component, e2e with the mock's `supported_parameters`; screens `T15-01`, `T15-07`).
- [x] Ask and Summarize send the level; Test connection and title generation never do (component tests for all three provider kinds; e2e on the mock's `reasoningEfforts`).
- [x] A provider rejection shows the `thinking-unsupported` message with Retry; after setting Default, Retry succeeds (component, e2e; screens `T15-05`, `T15-06`). No automatic retry; the provider's text is not shown.
- [x] The control is keyboard operable and has its accessible name in both locales (component tests in `en` and `de`; e2e sets High with the keyboard only).
- [x] The header fits a 320 px sidebar with a 65-character model name; the level's value is never cut off (e2e at 320, 400 and 640 px; screens `T15-08`, `T15-09`, `T15-10`).
- [x] New strings are in `en` and `de` (`tests/locales.test.ts`); the README has the Features line.
- [x] No manifest, permission, dependency or message-protocol change; no stored data beyond spec 5.
- [x] The orchestrator has looked at the build in both browsers: the Chromium screens `test-results/screens/T15-*.png`, and `dist/firefox-ext` loaded headless in Firefox 140 ESR as a temporary add-on, without extension errors.

Not as the spec's example has it: the control has no disabled state, because the model menu it follows has none (decisions.md T15-6). The owed "disabled state" test checks that both menus stay enabled while an answer streams and that a change applies to the next request only.

### Tests

- `tests/repository.test.ts` (`thinkingLevel`): a new session without the field, each level stored and read back, `null` for Default, kept across model and title changes, a record without the field, deletion.
- `tests/thinking.test.ts`: the session's level incl. damaged data; the model's info (own keys only, damaged entries, a provider cached before the feature); when the control shows; what a request carries.
- `tests/sidepanel-thinking.test.tsx`: the control (label and name, options and current mark, selection, nothing written for the current level, reopening, new session and switching back, keyboard, outside click, German, save error); its hidden and shown states; while an answer streams; the requests (Ask per level and at Default, Summarize, title request, Test connection, hidden control; Anthropic effort, budget and unknown, Gemini supported and unknown); the rejection (message, Retry at the same level, Default then Retry, after reopening, German, the same 400 at Default).
- `tests/provider-access.test.ts`: the text for `thinking-unsupported`. `tests/mock-llm.test.ts`: listed `supported_parameters`, the recorded efforts, the rejecting model.
- `tests/e2e/thinking.spec.ts`: the flow of the plan and the header widths; screens `T15-01-no-provider-hidden`, `T15-02-control-closed` (+ `-dark`), `T15-03-control-open` (+ `-dark`), `T15-04-high-answered` (+ `-dark`), `T15-05-rejected` (+ `-dark`), `T15-06-default-retry-ok`, `T15-07-unsupported-hidden`, `T15-08-narrow-320`, `T15-08-narrow-400`, `T15-09-narrow-320-open` (+ `-dark`), `T15-10-wide-640`.

## T16 Reasoning block, README, final report

Status: done (gate-checker PASS-WITH-NOTES, 2026-10-01)

### Plan

- `Transcript.tsx`: a reasoning block above the answer text for a stored answer (`Message.reasoning`) and for the live one (`LiveAnswer.reasoning`): a `<button>` row with `aria-expanded`, `aria-controls` and the chevron of the "Session tabs" toggle, collapsed by default; the body goes through the answer renderer without citation linking (`renderReasoning` in `markdown.ts`). Label "Thinking…" while the answer is live and has no text yet, else "Reasoning".
- The open state is kept in the transcript, in memory only, keyed by the question the answer belongs to, so a block opened while streaming stays open when the answer is stored; it is gone with a session switch or a reload.
- Auto-scroll: the transcript keeps following a growing block; opening or closing a block doesn't jump to the end.
- `style.css`: the row, and the body in the secondary colour, slightly smaller, with a left border; no height limit.
- Strings `reasoningThinking`, `reasoningLabel` in `en` and `de` (spec 4.7).
- Tests: `tests/sidepanel-reasoning.test.tsx` (no reasoning, collapsed, expanded, both labels, stopped and failed answers, live update while open, keyboard, reopened session, German, injected markup); `tests/chat-markdown.test.ts` (sanitiser for reasoning, no citation buttons); the "not in the DOM" assertion in `tests/sidepanel-chat.test.tsx` changed to the new behaviour.
- `tests/mock-llm/server.ts`: a scripted reply can hold the stream after its reasoning until the test releases it, so the "Thinking…" state is captured without sleeps; `tests/mock-llm.test.ts`.
- e2e `tests/e2e/reasoning.spec.ts`: reasoning before the answer, "Thinking…" then "Reasoning", expand, reload and expand again, injected markup; screens `T16-*` (light and dark, one at 320 px).
- README: one Features line, one Limits line. `docs/thinking-levels-report.md`. No manifest, permission or dependency change.
- Open questions: none so far.

### Acceptance

- [x] An assistant message with non-empty reasoning shows a toggle row above the answer text, collapsed by default, also while streaming; the open state is not stored (component tests; e2e incl. a reload and a session switch; screens `T16-01`, `T16-05`).
- [x] The row reads "Thinking…" while reasoning is arriving and no answer text has arrived yet, otherwise "Reasoning"; a stopped or failed answer with reasoning alone reads "Reasoning" (component tests in `en` and `de`; e2e; screens `T16-01`, `T16-04`, `T16-08`).
- [x] Expanded, it shows the reasoning through the answer's sanitised renderer, without citation linking, subdued against the answer; open while streaming, it updates live (component tests; e2e; screens `T16-02`, `T16-03`, `T16-04`).
- [x] The row is a real button with `aria-expanded` and `aria-controls`, operable by keyboard (component test; e2e with Enter and Space in Chromium).
- [x] A message without reasoning renders exactly as before: the same elements, no block (component test for a missing, `null` and empty field; e2e).
- [x] The same holds for a reopened session: collapsed, and it expands again from the stored answer (component test; e2e after a reload; screen `T16-06`).
- [x] Injected `<script>` or `onerror` in reasoning text does not execute (`tests/chat-markdown.test.ts`, component test, e2e in Chromium for the live and the reopened answer).
- [x] The transcript keeps following a streaming answer while the block is open and growing; opening a long block doesn't jump to its end (e2e; screen `T16-03`).
- [x] The answer text, the title request and the next request's history don't contain the reasoning (component tests of T14, updated; e2e on the mock's recorded requests).
- [x] New strings are in `en` and `de`; the README has the Features and the Limits line.
- [x] The final report `docs/thinking-levels-report.md` covers what shipped, deviations, known limitations per provider, manual checks and open questions.
- [x] No manifest, permission, dependency, stored-data or message-protocol change; reasoning is never logged.
- [x] The orchestrator has looked at the build in both browsers: the Chromium screens `test-results/screens/T16-*.png`, and `dist/firefox-ext` loaded headless in Firefox 140 ESR as a temporary add-on, without extension errors. The sidebar itself was not rendered in Firefox.

### Tests

- `tests/sidepanel-reasoning.test.tsx`: stored answers (no block without reasoning, collapsed, expanded as Markdown without citations, native button, one block and state per answer, stopped and failed with reasoning alone, reopened, session switch, German, injected markup) and streaming answers (both labels, live update while open and staying open when stored, Stop, failure and Retry, German).
- `tests/chat-markdown.test.ts` (`reasoning`): Markdown, the sanitiser, external links, no citation buttons.
- `tests/sidepanel-chat.test.tsx`: the former "reasoning is not in the page" assertion now checks the collapsed block, opens it and closes it.
- `tests/mock-llm.test.ts`: a stream held at given chunks until released, and a held stream whose client goes away.
- `tests/e2e/reasoning.spec.ts`: the flow of the plan; screens `T16-01-thinking-collapsed`, `T16-02-thinking-open`, `T16-04-answered-open`, `T16-05-answered-collapsed`, `T16-06-reopened-expanded`, `T16-07-narrow-320-expanded`, `T16-08-stopped-reasoning-only` (each also `-dark`) and `T16-03-thinking-open-growing`.

# Redesign

Spec: `specs/redesign.md`. Branch `feature/redesign`. Status values as above.

## T17 Visual foundation

Status: done (2026-10-03; gate-checker PASS-WITH-NOTES, orchestrator UI check in Chromium and Firefox 140)

### Plan

- Fonts: `npm pack @fontsource-variable/geist` and `@fontsource-variable/geist-mono` (not added to `package.json`); copy the latin and latin-ext variable woff2 files and the licence as `OFL.txt` into `src/entrypoints/sidepanel/fonts/`; `@font-face` rules in `style.css` with `url()` so Vite bundles them, `font-display: swap`, unicode ranges as in the packages. The licence ships in both builds (copied as a public asset).
- `style.css`: the §4.1 tokens in a light `:root` block and a dark `prefers-color-scheme` block; old token names (`--bg-raised`, `--bg-hover`, `--fg`, `--fg-muted`, `--border`, `--focus`, `--accent-fg`, `--danger-fg`, `--warning-bg`, `--warning-fg`, `--backdrop`) replaced, not aliased; tints via `color-mix()`.
- Type scale (§4.2), radii and 4 px spacing (§4.3), focus ring 2 px accent, 2 px offset on every interactive element, motion off under reduced motion; shared controls (§4.4): primary, secondary, danger buttons, inputs and selects, badges, notices. No layout change.
- `icons.tsx`: stroke 1.8; Settings becomes the sliders icon, Sessions the menu icon with the shorter third line.
- Tests: `tests/style-tokens.test.ts` (no colour literal outside the token blocks; every §4.1 token in both blocks; no old token names), `tests/style-contrast.test.ts` (4.5:1 for the §4.1 text/background pairs in both themes); e2e `tests/e2e/visual.spec.ts` (font requests stay on the extension origin, `document.fonts` reports Geist and Geist Mono loaded, screens `T17-01-main` light and dark at 400 px).
- Open questions: none so far.

### Acceptance

- [x] Every colour in `style.css` comes from spec 4.1; no hex or rgb outside the token blocks (`tests/style-tokens.test.ts`; one extra token, `--backdrop`, decisions.md Redesign T17-6).
- [x] The panel renders in Geist and Geist Mono with no network request for fonts (e2e in Chromium: requests stay on the extension origin, `document.fonts` reports both loaded); the licence ships in both builds as `assets/OFL.txt` (`tests/manifest.test.ts`). Firefox: the same files and CSS are in `dist/firefox-ext`; rendering there is the orchestrator's UI check.
- [x] Every interactive element shows the focus ring on keyboard focus (global `:focus-visible` rule; e2e tabs through the main view and checks every element reached).
- [x] Contrast of each text token on its background meets 4.5:1 in both themes (`tests/style-contrast.test.ts`; filled Delete uses `--on-accent`, decisions.md Redesign T17-7).
- [x] No behaviour change: the existing unit and e2e suites pass unchanged (no selector changes were needed); header buttons stay 30 px until T18 so the thinking-levels narrow-header e2e keeps passing (decisions.md Redesign T17-10).
- [x] UI check in both browsers (orchestrator): the Chromium screens `test-results/screens/T17-*.png`, and `dist/firefox-ext` installed headless in Firefox 140 ESR over WebDriver BiDi with the side panel page rendered in a tab, light and dark: body font Geist, `document.fonts` reports Geist loaded.

### Tests

- `tests/style-tokens.test.ts`: every spec 4.1 token in both blocks with its value, the same names in both blocks, no colour literal outside them, no undefined `var()`, a parser self-check.
- `tests/style-contrast.test.ts`: the text/background pairs in both themes, plus the WCAG reference values.
- `tests/manifest.test.ts`: the four woff2 files and `assets/OFL.txt` in both builds.
- `tests/e2e/visual.spec.ts`: fonts from the extension origin and loaded; focus rings; screens `T17-01-first-run`, `T17-02-answer`, `T17-03-focus-citation` (each also `-dark`), 400 px wide.

## T18 Header, composer and transcript

Status: done (2026-10-03; gate-checker PASS-WITH-NOTES, follow-up PASS, orchestrator UI check in Chromium and Firefox 140)

### Plan

- Header (`Header.tsx`, `SessionTitle.tsx`): menus leave the header; 36 px icon buttons (decisions.md Redesign T17-10); title block with a subtitle `<p>` beside the rename button (not in its name): pin count and "active <relative time>" from `session.updatedAt` via `relative-time.ts`, or "No pins yet"; re-rendered every 30 s. App keeps the shown session's `updatedAt` fresh after pin and message changes.
- Composer (`Composer.tsx`): one card with the textarea and a toolbar (Model menu, Thinking menu, spacer, Summarize, Send); keyboard hint under it, or the existing unavailable hints with the card at 70 % opacity. Send runs the same `canSend` check as Enter. `ActionBar.tsx` removed; Summarize becomes `SummarizeButton.tsx` (same unavailable tooltip, opening above, right-aligned); icon only below 360 px.
- Menus (`ModelMenu.tsx`, `ThinkingMenu.tsx`): pill with accent dot / transparent lightbulb with the level name; lists open upward, left-aligned, max height the space above, shifted to stay inside the panel (shared hook).
- Transcript: 14/18 px padding, empty-state illustration (inline, `aria-hidden`), citations show the number only (`markdown.ts`).
- Strings: header activity, no pins, Send, keyboard hint (en, de); `thinkingButton` removed. Session-tabs strings stay for T19.
- Tests: Header component tests (subtitle, refresh with fake timers), composer (Send states, hints, Enter/Send parity), Thinking text and name, citation text and name, narrow Summarize; update header, thinking, summarize, chat, markdown tests; e2e `tests/e2e/composer.spec.ts` (Send, both menus, Summarize, Stop, screens T18-* at 400 and 320 light and dark); `thinking.spec.ts` narrow-header test becomes a composer-toolbar fit test.
- Open questions: none so far.

### Acceptance

- [x] Every bullet of spec 5.1, 5.3 and 5.4 holds (component tests in `tests/sidepanel-header.test.tsx`, `tests/sidepanel-composer.test.tsx`, `tests/sidepanel-thinking.test.tsx`; e2e `tests/e2e/composer.spec.ts`). Deviation: the model menu stays hidden without any provider, as today (decisions.md Redesign T18-6).
- [x] Model and Thinking menus work from the composer with mouse and keyboard, open upward and stay inside the panel at 320 and 600+ px (`composer.spec.ts` at 320 and 400 px; `thinking.spec.ts` at 320, 400 and 640 px).
- [x] Send and Enter behave identically in every state: empty or blank input, streaming, no provider, no access (`sidepanel-composer.test.tsx`; e2e: Send disabled and Enter not sending while streaming).
- [x] Summarize keeps its unavailable tooltip, now above the button and right-aligned (`sidepanel-composer.test.tsx`, `summarize.spec.ts`).
- [x] Citations show numbers only and keep their accessible names and click behaviour (`chat-markdown.test.ts`, `sidepanel-composer.test.tsx`, `chat.spec.ts`, `composer.spec.ts`).
- [x] UI check in both browsers (orchestrator): the Chromium screens `test-results/screens/T18-*-400.png` and `-320.png` (each also `-dark`) compared with `Main.dc.html` and `Welcome.dc.html`; two polish fixes followed (T18-12, T18-13). `dist/firefox-ext` rendered headless in Firefox 140 ESR at 320 px, light and dark: header subtitle, composer card, empty state.

### Tests

- `tests/sidepanel-header.test.tsx`: subtitle without pins, with pins, singular, refresh every 30 s (fake timers), German, following a stored question; the rename button's name excludes the subtitle.
- `tests/sidepanel-composer.test.tsx`: Send placement, disabled states and parity with Enter, Shift+Enter, focus after Send; keyboard hint versus the no-provider and no-access hints and the faded card; German; Summarize name, icon, tooltip and the narrow rule; model button dot and "No model"; citation text, name and click; the empty-state illustration.
- Updated: `tests/sidepanel-thinking.test.tsx` (level name only, toolbar order), `tests/chat-markdown.test.ts`, `tests/sidepanel-chat.test.tsx`, `tests/sidepanel-reasoning.test.tsx` (citation text), `tests/e2e/thinking.spec.ts` (toolbar fit replaces the narrow header), `tests/e2e/summarize.spec.ts` (keyboard path to Summarize, citation text), `tests/e2e/chat.spec.ts` (citation selectors).
- e2e `tests/e2e/composer.spec.ts`: screens `T18-01-no-provider`, `T18-02-idle`, `T18-03-model-menu-open`, `T18-04-thinking-menu-open`, `T18-05-streaming`, `T18-06-answer-citations`, each at `-400` and `-320`, light and `-dark`.

### Follow-up after the gate (orchestrator's screenshot review)

- [x] Composer focus shows on the card (2 px accent outline, 2 px offset) while the input has focus; the input draws none; toolbar buttons keep their own ring (decisions.md Redesign T18-12; `composer.spec.ts`, `visual.spec.ts`).
- [x] A citation chip is flush with the punctuation after it: no chip margin (decisions.md Redesign T18-13; unit test for "text [1].", CSS check, e2e gap under 0.5 px).
- Gate passed again after the follow-up.

## T19 Session tabs and banners

Status: done (2026-10-03; gate-checker PASS, orchestrator UI check in Chromium and Firefox 140)

### Plan

- Citation numbers: `src/shared/chat/citation.ts` (orchestrator decision), `citationNumber(position)` for the position in pins-then-current-tab order; `assembleContext` and `SessionTabs` both call it. Unit tests first (`tests/chat-citation.test.ts`), including a mocked helper to show `assembleContext` uses it.
- `SessionTabs.tsx`: toggle with chevron, section label "Session tabs" and a Geist Mono count pill (name "Session tabs N"); pins in one card; 24 px tile with favicon or a fallback icon by type (globe, play, file); meta line number · host · type, "Current tab", "Truncated"; status on the right (dot with hidden "Ready", spinner and "Extracting…", "Failed"), replaced by the actions on hover and `:focus-within` (actions stay in the tab order while hidden); current-tab card (dashed accent border, accent-soft, number pins+1, eye, "Pin" text button named "Pin to session"); unreadable rows dashed `--line` with the globe tile.
- `AccessBanner.tsx`: surface card with shadow, shield tile, primary Allow, plain Dismiss. Provider notice and error banners as spec 4.4 notices (cards with margins).
- Icons: play, file, shield, spinner. Strings: `sessionTabsLabel`, `pinButton` (en, de); `sessionTabsHeading` removed.
- Tests: update `sidepanel-session-tabs`, `sidepanel-access`, `sidepanel-app`, `sidepanel-drawer` and the e2e toggle names; new component tests for row states, fallback icons, numbering, current row included/excluded, toggle name; e2e `tests/e2e/session-tabs.spec.ts` (page, YouTube and PDF pins, numbers against a cited answer, excluded current tab, keyboard open; screens T19-*).
- Open questions: none so far.

### Acceptance

- [x] Every bullet of spec 5.2 and 5.5 holds (component tests in `tests/sidepanel-session-tabs.test.tsx` and `tests/sidepanel-access.test.tsx`; e2e `tests/e2e/session-tabs.spec.ts`; decisions.md Redesign T19).
- [x] The number on each pin row and on the current-tab row equals the citation number the model receives, with a failed pin, an extracting pin, and the current tab unpinned, excluded and pinned (`tests/chat-citation.test.ts`; e2e compares the rows with the `<<<PAGE n>>>` lines of each request and a cited answer).
- [x] Row actions are reachable and usable by keyboard alone (e2e: Tab from the toggle reaches Open, the actions show with the focus ring, Enter opens the page; decisions.md Redesign T19-4).
- [x] UI check in both browsers (orchestrator): the Chromium screens `test-results/screens/T19-*.png` (light and dark) compared with `Main.dc.html` and `Welcome.dc.html`; `dist/firefox-ext` rendered headless in Firefox 140 ESR, light and dark: access banner card, section label with count, restricted current-tab row, Geist and Geist Mono loaded.

### Tests

- `tests/chat-citation.test.ts`: the helper, and `assembleContext` taking its numbers from it; non-ready pins keep their numbers; no current-tab number when the tab isn't sent.
- `tests/sidepanel-session-tabs.test.tsx`: toggle name and count pill; meta lines with numbers, host, type, "Current tab", "Truncated"; ready dot with hidden "Ready", spinner with "Extracting…", "Failed" with the reason; fallback icons by type; actions in the DOM and tab order; current-tab row with the Pin text button, included and excluded; pinned current tab; not-accessible and restricted rows; German. Updated names in `sidepanel-app`, `sidepanel-access` (plus the banner card), `sidepanel-drawer`.
- e2e `tests/e2e/session-tabs.spec.ts`: screens `T19-01-first-run`, `T19-02-all-states`, `T19-03-row-hovered`, `T19-04-collapsed`, `T19-05-provider-notice` (each also `-dark`). Updated `pinning.spec.ts` (hover before row actions; toggle name), `page-access.spec.ts`, `sessions.spec.ts` (toggle name), `youtube.spec.ts`, `pdf.spec.ts` (type selector).

## T20 Drawer, settings, README, final report

Status: done (2026-10-03; gate-checker PASS, orchestrator UI check in Chromium and Firefox 140)

### Plan

- Date grouping (orchestrator decision): pure module `src/entrypoints/sidepanel/date-groups.ts` next to `relative-time.ts`, `groupByDate(items, at, now)` returning the non-empty groups "today", "thisWeek", "earlier" in that order (local time, weeks start on Monday). Unit tests first (`tests/date-groups.test.ts`): today, this week, earlier, empty groups, local midnight, Monday, Sunday, future times.
- `SessionsDrawer.tsx` (spec 5.6): width min(88 %, 320 px) with right border and shadow; header 17 px/600 with Close; full-width "New session" button (accent-soft, plus icon) that does what the header's does and closes the drawer; one list per group under a section label; row title 600 active / 500 otherwise, active row accent-soft with a 7 px accent dot; delete shown on row hover and `:focus-within` (stays in the tab order, as T19-4); the delete confirm a danger-tinted card. App passes `onNewSession`.
- Settings (spec 5.7): header Back + "Settings" 16 px/600; body 16 px 12 px, sections 20 px apart, each a section label above a 12 px card; "Add provider" accent text button with plus icon; provider rows with a 32 px letter tile, name and badges, type · model (Geist Mono), no-access notice as a warning notice with its link, Make default / Edit links, trash; page access state with an ok/warning dot; footer "Browser Sidekick <version>" from `browser.runtime.getManifest().version`.
- Strings: `drawerGroupToday`, `drawerGroupThisWeek`, `drawerGroupEarlier` (en, de).
- Tests: component tests for drawer groups, active row, delete on hover/focus, New session in the drawer; provider tile and badges, page access dot, version footer; update drawer, settings and access tests; e2e `tests/e2e/drawer-settings.spec.ts` (sessions with set activity times, delete, new from drawer; add and edit a provider against the mock LLM; screens T20-* light and dark); update `sessions.spec.ts` keyboard path.
- README: drawer grouping line if needed; final report `docs/redesign-report.md`.
- Open questions: none so far.

### Acceptance

- [x] Every bullet of spec 5.6 and 5.7 holds (component tests in `tests/sidepanel-drawer-layout.test.tsx`, `tests/sidepanel-drawer.test.tsx`, `tests/sidepanel-settings.test.tsx`; decisions.md Redesign T20). The drawer's keyboard path and hover delete are also covered by the updated `sessions.spec.ts`.
- [x] Grouping is correct around midnight and on Mondays (`tests/date-groups.test.ts`, run in UTC, Europe/Berlin, America/Los_Angeles and Pacific/Kiritimati; `tests/sidepanel-drawer-layout.test.tsx` for Monday).
- [x] The README matches the shipped UI (Features: date-grouped Sessions list; the model, thinking and Settings lines were updated in T17 and T18).
- [x] The final report `docs/redesign-report.md` is written (allowed by the owner after the permission prompt first declined it; questions.md Redesign closed 2).
- [x] e2e for spec 5.6 and 5.7 (`tests/e2e/drawer-settings.spec.ts`, screens T20-01 to T20-08, light and dark); allowed by the owner after the permission prompt first declined it (questions.md Redesign closed 1).
- [x] UI check in both browsers (orchestrator): the T20 build loaded in Chromium with four sessions of different ages (drawer groups, hover delete, active dot, settings, provider form; light and dark; no overflow at 400 px), and `dist/firefox-ext` rendered headless in Firefox 140 ESR with the drawer and settings opened, light and dark.

### Tests

- `tests/date-groups.test.ts`: today, this week from Monday, earlier, local midnight, Monday and Sunday, future times, daylight-saving changes, month boundary; empty groups left out, order kept.
- `tests/sidepanel-drawer-layout.test.tsx`: groups and their labels (en, de), empty groups, Monday, active row dot, meta line, delete button per row in the tab order, the hover/focus CSS rule, confirm card, New session button.
- `tests/sidepanel-drawer.test.tsx`: New session from the drawer starts and shows a session, closes the drawer, returns focus.
- `tests/sidepanel-settings.test.tsx`: section labels above cards, Add provider text button, provider tile, badges, model in mono, no-access notice, confirm card, page access dot (ok and warning), version footer from the manifest, provider form in a card.
- e2e `tests/e2e/drawer-settings.spec.ts`: sessions with set activity times on a fixed clock, groups, active row, delete on hover and on keyboard focus, delete confirm, New session from the drawer, Monday after midnight; settings footer version, page access dot, add and edit a provider against the mock LLM, provider tile, badge and mono model, delete confirm. Screens `T20-01-drawer`, `T20-02-row-hovered`, `T20-03-delete-focused`, `T20-04-delete-confirm`, `T20-05-provider-form`, `T20-06-settings`, `T20-07-provider-form-edit`, `T20-08-provider-delete-confirm` (each also `-dark`).
- Updated `tests/e2e/sessions.spec.ts` (Tab path with the drawer's New session; delete after hovering the row). `tests/helpers/sidebar.tsx` fakes `runtime.getManifest`.
- Gate (2026-10-03): lint, typecheck, 1324 unit tests in 55 files, build, check:dist, lint:firefox (0 errors, 18 warnings), 23 e2e tests passed.

## T21 New session next to Summarize

Status: done (2026-10-06; gate passed; Firefox UI check left to the orchestrator)

### Plan

- Orchestrator decision: `Composer` gets an `onNewSession` prop and renders New session (existing `PlusIcon`, `newSession` string as name and tooltip) in the toolbar between the spacer and Summarize; `Header` loses the button and its `onNewSession` prop. `App.tsx` passes the same handler as before.
- CSS: the button is 30 px high like Summarize and stays unfaded when asking is unavailable, so the 70 % fade moves from the card to its contents other than New session.
- Tests: header (no New session, order Sessions, title, Settings), composer (toolbar order, name and tooltip, click calls the handler, enabled with no provider and no access, unfaded), app-level New session still works with focus on the button afterwards; 320 px no-overflow e2e check.
- e2e: role-based selectors keep working; new `tests/e2e/new-session.spec.ts` with screens T21 at 400 px and 320 px, light and dark: idle and no provider.
- README lines that say where New session is; addendum to `docs/redesign-report.md`.
- Open questions: none.

### Acceptance

- [x] The header has no New session button; the toolbar shows Model, Thinking, space, New session, Summarize, Send (`tests/sidepanel-header.test.tsx`, `tests/sidepanel-composer.test.tsx`, `tests/sidepanel-thinking.test.tsx`, e2e `new-session.spec.ts`).
- [x] New session from the composer behaves as the header button did: same handler from `App.tsx`, focus stays on the button (component test and e2e).
- [x] Nothing in the toolbar wraps or overflows at 320 px; the long model name is cut off while New session, Summarize and Send keep their size (e2e `new-session.spec.ts`, `composer.spec.ts`).
- [x] New session stays enabled and unfaded with no provider and with no access (component tests and e2e).
- [x] README and `docs/redesign-report.md` addendum updated.
- [ ] UI check in Firefox: not done by the implementer; Chromium screens `T21-*` compared with the `Main.dc.html` composer.

### Tests

- `tests/sidepanel-composer.test.tsx`: toolbar order by id, New session name, tooltip, icon, position after the spacer, click calls the handler, enabled with no provider and no access, the fade rule leaves it out, German name.
- `tests/sidepanel-header.test.tsx`: header buttons are Sessions, rename, Settings; New session in the composer creates and shows a session and keeps focus. `tests/sidepanel-thinking.test.tsx`: toolbar order.
- e2e `tests/e2e/new-session.spec.ts`: screens `T21-01-no-provider-400`, `-320`, `T21-02-idle-400`, `-320` (each also `-dark`); no provider, no access, long model at 320 px. `composer.spec.ts`: toolbar line includes New session; fade read from the textarea.
- Gate (2026-10-06): lint, typecheck, 1330 unit tests in 55 files, build, check:dist, lint:firefox (0 errors, 18 warnings), 24 e2e tests passed.
