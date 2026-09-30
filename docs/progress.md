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

Status: in progress

### Plan

- Add `idb` (runtime, spec section 6) and `fake-indexeddb` (dev, spec section 6).
- `src/shared/model.ts`: `Session` (`providerId`, `model`, `titleSource`), `Pin`, `Message` (with `MessageSource[]`), `ProviderConfig`, `Settings`, and their unions.
- `src/shared/db/schema.ts`: `sidekick` DB, schema version 1 (`sessions` by `updatedAt`, `pins` and `messages` by `sessionId`), and a migration hook that runs one step per version.
- `src/shared/db/repository.ts`: session, pin and message CRUD, sessions listed by `updatedAt`, cascade delete, delete-all; adding a pin or message bumps `updatedAt` in the same transaction.
- `src/shared/settings.ts`: settings store over `storage.local` only (one key per field, defaults, change listener, reset for Delete all data).
- Manifest: add `storage` to both targets (decision T01-4) and update the snapshot test.
- Tests: repository on `fake-indexeddb`, migration hook, settings store on `fakeBrowser`, sync storage never called, API key never in IndexedDB.
- Open questions: none so far.
