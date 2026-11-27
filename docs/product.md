# Browser Sidekick — Product

Current-state product overview. Rewritten in place when shipped user-visible behavior changes.

## What it is

Browser Sidekick is a Manifest V3 sidebar extension for **Chrome (116+)** and **Firefox desktop (140.0+)**. Users pin the pages they are reading into a local session and ask their own LLM (BYOK or local server) to answer questions or summarize them, with numbered source citations.

## Core user flows

- **Sessions & pinned pages:** Open the sidebar from the toolbar icon. Pin the active tab from the sidebar or via the page/tab right-click menu (`Pin to Sidekick`). Each pin stores a text snapshot that can be refreshed while the tab is open or unpinned at any time. Sessions persist locally until deleted, auto-title from conversation (user-edited titles are never overwritten), and are grouped into **Today**, **This week**, and **Earlier**. `New session` sits beside `Summarize` under the composer.
- **Content extraction:**
  - **Web pages:** Article text extracted via `@mozilla/readability`.
  - **YouTube videos:** Video transcript (falls back to title and description when captions are unavailable).
  - **PDFs:** Text layer extracted via bundled `pdfjs-dist` (`offscreen` document in Chrome, background context in Firefox).
- **Ask & Summarize:**
  - Questions use all pinned pages in the session plus the active tab when accessible.
  - `Summarize` runs at one of four levels (`Very short`, `Short`, `Standard`, `Detailed`) chosen from the split-button menu and remembered across sessions (`Standard` by default).
  - Answers stream in with Markdown rendering and clickable `[n]` citations matching each page's number in the session list; answers can be stopped mid-stream or retried on error, and show a notice when history or page text was trimmed to fit the context budget.
- **BYOK providers, thinking level & reasoning:**
  - Supports **Anthropic**, **Google Gemini**, and any **OpenAI-compatible API** (OpenAI, OpenRouter, Groq, Ollama, LM Studio, etc.). Multiple providers can be saved; provider and model are selectable per session under the composer.
  - Per-session **Thinking level** (`Default`, `Low`, `Medium`, `High`) is discovered from provider model lists and hidden for models known not to support it.
  - When a provider returns reasoning text, a collapsed **Reasoning** disclosure renders above the answer and is saved with it (never sent back in follow-up turns or counted toward context budget).
- **Visual design, accessibility & locales:**
  - Follows the system Light/Dark theme via `prefers-color-scheme` (no manual theme toggle), using bundled **Geist** and **Geist Mono** fonts, semantic surface/accent tokens (`--accent` `#2D5BE3` light / `#8EA8EE` dark), ≥ 4.5:1 contrast, and ≤ 150 ms transitions disabled under `prefers-reduced-motion: reduce`. Visual reference mockups live in `design/redesign/`.
  - English (`en`) and German (`de`) interfaces (`public/_locales/{en,de}/messages.json`), following browser locale.

## Current limits & non-goals

- Requires a user-supplied API key or local OpenAI-compatible server; no hosted backend or built-in model.
- Desktop Chrome 116+ and Firefox 140.0+ only; Firefox for Android, Edge, and Safari are out of scope.
- Text-only extraction: images are not sent to models, and scanned/image-only, password-protected, or > 30 MB PDFs cannot be read.
- Restricted pages (`file://`, browser settings, extension stores, other extensions) cannot be read.
- Hard caps: 200,000 characters per pin; 100,000 tokens default provider context budget.
- No web search or tool calling by the model; no reasoning block from OpenAI's own API (it returns no reasoning text).
- No cross-device sync, export/import, or full-text search across sessions.
