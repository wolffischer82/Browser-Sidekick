# 0001 — WXT Manifest V3 for Chrome and Firefox with Minimal Permissions

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Browser Sidekick needs a single codebase that targets both Chrome's `sidePanel` and Firefox's `sidebar_action` under Manifest V3 without requesting broad always-on permissions (`tabs`, `history`, or persistent `<all_urls>` content scripts) that raise user privacy concerns and slow Chrome Web Store / AMO reviews.

## Decision

Build with **WXT** (`wxt.config.ts`) emitting separate MV3 targets (`dist/chrome-ext` for Chrome 116+, `dist/firefox-ext` for Firefox desktop 140.0+ with fixed add-on ID `browser-sidekick@wolffischer82.github.io`). Use on-demand injection (`activeTab` + `scripting` + `contextMenus`) and keep `<all_urls>` strictly in `optional_host_permissions`. Parse PDFs in Chrome's `offscreen` document and Firefox's background page.

## Consequences

- Users can pin pages via context menu even without granting all-sites access.
- Both stores see a minimal, easily justified permission set (`tests/manifest.test.ts` guards against accidental expansion).
- Firefox `zip.includeSources` must stay an explicit allowlist so AMO reviewers can reproduce `dist/firefox-ext` deterministically (`npm run verify:zips`).
