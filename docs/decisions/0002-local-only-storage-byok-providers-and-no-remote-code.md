# 0002 — Local-Only Storage, BYOK Providers, and No Remote Code

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Users pin private web pages, transcripts, and PDFs alongside personal LLM API keys. Running a relay backend, syncing keys via browser cloud sync, or fetching remote workers/fonts would add privacy risk, store-review friction, and operational maintenance.

## Decision

- Keep all user data on-device: settings and API keys in `storage.local` (never `storage.sync`), sessions/pins/messages in IndexedDB (`sidekick` v1 with forward-only migrations).
- Call user-configured providers directly from the extension (Anthropic, Google Gemini, or any OpenAI-compatible endpoint including local servers) with zero telemetry.
- Bundle every runtime asset locally (`pdf.worker.js`, Geist `.woff2` fonts, `assets/OFL.txt`) and sanitize all LLM Markdown output with `dompurify`.

## Consequences

- Zero backend cost, zero developer access to user data, and strict compliance with Chrome Web Store and AMO no-remote-code rules.
- No cross-device sync or built-in free model; users supply their own key or local model server.
