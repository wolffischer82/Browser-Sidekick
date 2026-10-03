# Browser Sidekick

A sidebar extension for Chrome and Firefox. Pin the pages you're reading into a session, then ask your own LLM about them or have it summarise them.

Status: MVP, version 0.1.0. It isn't in the Chrome Web Store or on addons.mozilla.org.

## Features

- **Sessions of pinned pages.** Pin the current tab from the sidebar, or right-click a page and choose "Pin to Sidekick". Each pin stores a snapshot of the page's text, which you can refresh while the tab is open. Sessions are kept until you delete them, and you can switch between them and rename them.
- **Web pages, YouTube and PDFs.** Articles are reduced to their readable text, YouTube videos to their transcript, and PDFs to their text layer.
- **Ask and summarise.** Questions are answered from the pinned pages plus the tab you're on. Summarize gives a short summary per page and an overall one. Answers stream in and cite their sources by number, the number each page shows in the session list; clicking a number opens that page.
- **Your own provider and key.** Works with Anthropic, Google Gemini and any OpenAI-compatible API (OpenAI, OpenRouter, Groq, or a local server such as Ollama or LM Studio). You can save several providers and choose the model per session, under the question box.
- **Thinking level per session.** Next to the model, choose how much the model should think before it answers: Default, Low, Medium or High. The control is hidden for models known not to support it.
- **Reasoning on demand.** When the model returns its reasoning, a collapsed "Reasoning" row above the answer opens it. It is saved with the answer.
- **Local data.** Sessions, pins, chat history and API keys stay on your device. Page text goes only to the provider you chose, and only when you ask or summarise. There is no telemetry.
- **Minimal permissions.** Access to all sites is optional. Without it, the extension can still read a page you pin through the right-click menu.
- **English and German** interface, following the browser's language.

## Limits

- You need an API key or a local model server. No model is built in.
- Chrome 116 or later and Firefox desktop 140 or later. Firefox for Android, Edge and Safari aren't supported.
- Text only. Images aren't sent to the model, and scanned PDFs without a text layer can't be read.
- PDFs larger than 30 MB or protected by a password can't be read.
- Local files (`file://`), browser pages, extension stores and other extensions' pages can't be read.
- A YouTube video without captions contributes only its title and description.
- Each pin holds at most 200,000 characters. When pages and history exceed the provider's context budget (100,000 tokens by default), older history is dropped and page text is shortened.
- The model can't search the web or use tools. It sees only the pages you give it.
- OpenAI's own API returns no reasoning text, so OpenAI models show no reasoning block.
- No sync between devices, no export or import, no search across sessions.

## Install

### Use the committed builds

The repository contains ready-to-load builds in `dist/`, so you don't need Node.js. Clone the repository or download it as a ZIP, then:

- **Chrome:** open `chrome://extensions`, turn on "Developer mode", choose "Load unpacked" and select `dist/chrome-ext`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on…" and select `dist/firefox-ext/manifest.json`. Firefox removes a temporary add-on when it closes, so you load it again after a restart.

Click the toolbar icon to open the sidebar, then add a provider under Settings (the sliders icon at the top right).

### Build it yourself

You need Node.js 20.19 or later.

```sh
npm ci
npm run build
```

This rewrites `dist/chrome-ext` and `dist/firefox-ext` from source. Load them as described above. `npm run build:chrome` and `npm run build:firefox` build one target only.

## Development

`npm run dev` (Chrome) and `npm run dev:firefox` start a browser with the extension and reload it on changes. `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e` run the checks.

The builds in `dist/` are tracked in git. CI fails if they differ from a fresh build (`npm run check:dist`), so rebuild and commit them with every source change, and don't edit them by hand.

Specs live in `specs/`, decision and progress logs in `docs/`. Builds and CI run on the self-hosted runner `lenovo-ai-server`; see `CLAUDE.md` for how work is driven.
