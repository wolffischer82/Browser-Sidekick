# Browser Sidekick

A browser extension for Chrome and Firefox.

The loadable builds are committed: `dist/chrome-ext` (Chrome: Load unpacked) and `dist/firefox-ext` (Firefox: Load Temporary Add-on on its `manifest.json`). `npm run build` rewrites both from source, and CI fails if the committed builds differ from a fresh build (`npm run check:dist`).

Specs live in `specs/`, decision and progress logs in `docs/`. Builds and CI run on the self-hosted runner `lenovo-ai-server`; see `CLAUDE.md` for how work is driven.
