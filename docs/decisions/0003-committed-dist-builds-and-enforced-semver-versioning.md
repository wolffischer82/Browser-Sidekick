# 0003 — Committed Unpacked Builds and Enforced Semver Versioning

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

While Browser Sidekick is loaded directly from git (and before/between store releases), users need ready-to-load unpacked Chrome and Firefox folders without installing Node.js, and both Chrome Web Store and AMO reject duplicate version numbers on upload.

## Decision

- Commit `dist/chrome-ext` and `dist/firefox-ext` to git and fail CI if they drift from a fresh `npm run build` (`npm run check:dist`). Keep store `.zip` archives untracked in `dist/`.
- Enforce `x.y.z` semantic versioning and manifest/README parity via `scripts/check-version.mjs` (`npm run check:version`): minor (`y`) bumps on `feat:`, patch (`z`) bumps on bugfixes/runtime changes, major (`x`) requires explicit owner approval plus the `major-release` PR label, and docs/CI-only PRs keep the version unchanged.

## Consequences

- Anyone can clone the repo and immediately load `dist/chrome-ext` or `dist/firefox-ext`.
- Runtime PRs must include a single version bump, a rebuilt `dist/` commit, and an updated `README.md` status line before CI passes.
