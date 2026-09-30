# Progress

Spec: `specs/sidekick-mvp.md`. Status values: todo / in progress / done.

## T01 Scaffold and toolchain

Status: in progress (waiting for owner question 1 and the orchestrator's browser check)

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

- [ ] Both builds load unpacked without manifest warnings. Chrome: loaded headless in Chromium, side panel page renders. Firefox: not loaded yet (no Firefox on the runner); `web-ext lint` has 0 errors and 2 warnings (questions.md 1, decisions.md T01-8).
- [ ] Clicking the icon opens and closes the sidebar in Chrome and in Firefox. Needs the orchestrator's manual check.
- [ ] The gate passes on CI. Passes locally on the runner machine; the CI run needs the branch pushed (owner approval).
- [x] The heading renders in German when the browser UI language is German. Component test renders with the `de` messages; the German string is "Browser Sidekick", identical to English. Browser check by the orchestrator.

### Tests

- `tests/manifest.test.ts`: snapshot and exact permission lists per target.
- `tests/sidepanel-app.test.tsx`: sidebar root smoke test in `en` and `de`.
- `tests/locales.test.ts`: `en` and `de` have the same keys, no empty messages.
