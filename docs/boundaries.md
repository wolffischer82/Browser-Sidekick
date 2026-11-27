# Browser Sidekick — System Boundaries

Hard invariants and contracts. **Hard Stop:** stop and ask the owner before crossing or weakening any boundary below.

## 1. Browser targets & store identity

- **Chrome:** Manifest V3, `minimum_chrome_version: "116"`, `sidePanel` UI, `offscreen` document for PDF parsing.
- **Firefox desktop:** Manifest V3, `strict_min_version: "140.0"`, `sidebar_action` UI, background PDF parsing.
- **Immutable Firefox add-on ID:** `browser-sidekick@wolffischer82.github.io` in `wxt.config.ts` — **never change** (AMO identifies the listing by it).
- **Firefox `data_collection_permissions.required`:** `["websiteContent", "browsingActivity", "authenticationInfo", "personalCommunications"]`. Any change requires owner approval and store-doc updates.

## 2. Manifest permissions & host access

Permissions are locked to the narrowest working set and verified by `tests/manifest.test.ts` and `tests/store-listing.test.ts`:

- `permissions`: `storage`, `activeTab`, `scripting`, `contextMenus` (+ Chrome-only `offscreen`; WXT adds `sidePanel` on Chrome).
- `host_permissions`: `https://api.openai.com/*`, `https://api.anthropic.com/*`, `https://generativelanguage.googleapis.com/*`.
- `optional_host_permissions`: `<all_urls>` (optional; custom OpenAI-compatible provider origins are requested on save).
- **Forbidden:** `tabs`, `history`, `webRequest`, `downloads`, `unlimitedStorage`, and persistent content scripts.
- Adding or widening any permission or host permission is an owner decision and must update `PRIVACY.md`, `PRIVACY.de.md`, and `docs/store/` in the same PR.

## 3. Privacy, security & zero remote code

- **No telemetry or developer backend:** Data never leaves the browser except to the user's chosen LLM provider on explicit Ask, Summarize, or session-title generation.
- **No remote code or runtime CDNs:** `pdfjs-dist`'s `pdf.worker.js` and Geist `.woff2` fonts (plus `assets/OFL.txt`) are bundled locally via `wxt.config.ts` `build:publicAssets`.
- **Output sanitization:** All LLM Markdown is rendered with `marked` + `dompurify`; rendered external links carry `rel="noopener noreferrer"`.
- **Direct browser API calls:** Anthropic direct browser requests send `anthropic-dangerous-direct-browser-access: true`; provider API keys stay in `storage.local` and are never logged.
- **Source hygiene:** Never log, print, or transmit page content, URLs, or browsing history in `src/`. No `console.log` or `debugger` in shipped code; no unexplained lint-disable comments.

## 4. Storage & data contracts

- **Settings (`storage.local` only — never `storage.sync`):** `src/shared/settings.ts` stores `providers` (including API keys), `defaultProviderId`, `activeSessionId`, `sessionTabsExpanded`, `accessBannerDismissed`, and `summaryLevel` (default `'standard'`).
- **Sessions, pins & messages (IndexedDB `sidekick` v1):** `src/shared/db/schema.ts` owns object stores `sessions`, `pins`, and `messages` with forward-only `MIGRATIONS`. Existing records must remain readable when optional fields (`thinkingLevel`, `error`, `reasoning`, `summaryLevel`) are absent or `null`.
- **Runtime caps:** Pin text capped at `200,000` characters; default provider context budget `100,000` tokens (`DEFAULT_CONTEXT_BUDGET`); PDF limit `30 MB`.
- **Localization:** Every new user-facing string must be added to both `public/_locales/en/messages.json` and `public/_locales/de/messages.json`.

## 5. Approved runtime dependencies

`package.json` `dependencies` are limited to `preact`, `@mozilla/readability`, `pdfjs-dist`, `marked`, `dompurify`, and `idb`. Adding or replacing a runtime dependency requires owner approval (and affects AMO source-review scope).

## 6. Committed builds, store docs & semantic versioning (`x.y.z`)

- **Committed builds:** `dist/chrome-ext` and `dist/firefox-ext` are tracked in git and must match `npm run build` (`npm run check:dist`). Never edit `dist/` by hand or commit store `.zip` archives.
- **Version parity (`npm run check:version`):** `package.json`, `package-lock.json`, `dist/chrome-ext/manifest.json`, `dist/firefox-ext/manifest.json`, and the `README.md` `Status: ..., version x.y.z` line must always match.
- **Bump policy (relative to `origin/main`):**
  - **Major (`x`):** owner-decided only; requires explicit owner approval and the `major-release` PR label.
  - **Minor (`y`):** bump on new features (`feat:`), resetting `z` to `0`.
  - **Patch (`z`):** bump on bugfixes (`fix:`) and non-feature changes touching `src/`, `public/`, or `wxt.config.ts`.
  - Docs-, test-, tooling-, or CI-only PRs leave the version unchanged.
- **Store & privacy parity:** Changes to permissions, stored data, limits, or user-visible features must keep `README.md`, `PRIVACY.md`, `PRIVACY.de.md`, and `docs/store/` aligned (enforced in part by `tests/store-listing.test.ts` and `tests/store-assets.test.ts`).
