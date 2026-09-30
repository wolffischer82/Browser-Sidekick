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

Status: in progress (implementation complete, awaiting gate-checker)

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
