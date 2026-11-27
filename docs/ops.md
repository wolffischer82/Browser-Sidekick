# Browser Sidekick — Operations & Delivery

Current-state CI, build, verification, and release runbook. Rewritten in place whenever workflows, scripts, or release steps change.

## Delivery model

- **Worktrees & branches:** Never commit or push directly to `main`. Develop in a dedicated worktree under `~/Projects/.worktrees/<name>` on a staging or feature branch and open a PR into `main`.
- **Git author email:** Commit with `75468956+wolffischer82@users.noreply.github.com` (repo-local config).
- **Compute model:** GitHub hosts the repo and PRs; all CI runs on the self-hosted runner on `lenovo-ai-server` (`actions.runner.lenovo-ai-server-sidekick.service`, labels `[self-hosted, Linux, X64]`). No GitHub-hosted runners, no setup/cache actions, no uploaded CI artifacts.

## Deterministic CI (`.github/workflows/ci.yml`)

Triggers on `push` to `main`, all `pull_request` events, and manual `workflow_dispatch`:

1. `npm ci`
2. `npm run lint` (`eslint . && prettier --check .` — includes Markdown and YAML)
3. `npm run typecheck` (`wxt prepare && tsc --noEmit`)
4. `npm test` (Vitest unit, component, manifest, and store-listing/asset tests)
5. `npm run build` (`wxt build -b chrome && wxt build -b firefox`)
6. `npm run check:dist` (fails if tracked `dist/chrome-ext` or `dist/firefox-ext` differ from the fresh build)
7. `npm run check:version` (`scripts/check-version.mjs`: parity across `package.json`, `package-lock.json`, both manifests, and `README.md`, plus semver bump rules)
8. `npm run lint:firefox` (`web-ext lint --source-dir dist/firefox-ext`)
9. `npm run e2e` (Playwright Chromium extension e2e suite against the built `dist/chrome-ext`; failure traces/screenshots stay local in `test-results/`)

## Local development & utility commands

Requires Node.js 20.19+:

```sh
npm run dev           # Live-reloading Chrome dev build
npm run dev:firefox   # Live-reloading Firefox dev build
npm run format        # Prettier write across repo
npm run icons         # Re-export PNG icons from design/icon.svg
npm run store:assets  # Regenerate store screenshots & promo tiles in docs/store/assets/
```

## Store packaging & publishing

Store uploads always require explicit owner action/approval:

```sh
npm run zip          # Build Chrome, Firefox, and AMO sources zips into dist/ (git-ignored)
npm run verify:zips  # Confirm the sources zip reproduces dist/firefox-ext byte-for-byte
```

Follow [docs/publishing.md](publishing.md) and the store-form files in `docs/store/` (`listing.en.md`, `listing.de.md`, `chrome-web-store.md`, `amo.md`) for Chrome Web Store and addons.mozilla.org submissions and updates.

## Secrets & credentials

- Zero secrets or API keys live in this repository or in CI.
- User LLM API keys are stored solely in browser `storage.local` at runtime; e2e and store-asset suites run against a local mock LLM server.
