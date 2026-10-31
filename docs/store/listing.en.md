# Store listing (English)

Copy each text block as it is. Blocks marked `text` are plain text; the stores show line breaks but no Markdown. The character limits are checked by `tests/store-listing.test.ts`.

## Name

```text
Browser Sidekick
```

Both stores take the name from the extension's manifest (`extName` in `public/_locales/en/messages.json`).

## Chrome short description

At most 132 characters. The Chrome Web Store takes this summary from the manifest's `description`, which is `extDescription` in `public/_locales/en/messages.json`, and, at the time of writing, doesn't let you edit it in the dashboard. This text is that string, so the listing and the package agree. A different text would need a new extension version with the changed locale string.

```text
Pin pages to a session and ask your own LLM about them.
```

## AMO summary

At most 250 characters.

```text
Ask your own LLM about the pages you read, in a sidebar. Pin web pages, YouTube videos and PDFs into sessions, ask questions or get a summary, with numbered citations back to each page. Works with Anthropic, Google Gemini and OpenAI-compatible APIs.
```

## Full description

```text
Browser Sidekick is a sidebar for Chrome and Firefox. Pin the pages you're reading into a session, then ask your own LLM about them or have it summarise them.

WHAT IT DOES

- Sessions of pinned pages: pin the current tab from the sidebar, or right-click a page and choose "Pin to Sidekick". Each pin keeps a snapshot of the page's text, which you can refresh while the tab is open. Sessions are kept until you delete them, and you can switch between them and rename them.
- Web pages, YouTube and PDFs: articles are reduced to their readable text, YouTube videos to their transcript, and PDFs to their text layer.
- Ask and summarise: questions are answered from the pinned pages plus the tab you're on. Summarize gives a short summary per page and an overall one. Answers stream in and cite their sources by number; clicking a number opens that page.
- Your own provider and key: works with Anthropic, Google Gemini and any OpenAI-compatible API (OpenAI, OpenRouter, Groq, or a local server such as Ollama or LM Studio). You can save several providers and choose the model per session.
- Thinking level per session: choose how much the model should think before it answers (Default, Low, Medium or High), for models that support it.
- Reasoning on demand: when the model returns its reasoning, you can open it above the answer.
- Local data: sessions, pins, chat history and API keys stay on your device. Page text goes only to the provider you chose, and only when you ask or summarise. There is no telemetry.
- Minimal permissions: access to all sites is optional. Without it, the extension can still read a page you pin through the right-click menu.
- English and German interface, following the browser's language.

LIMITS

- You need an API key or a local model server. No model is built in.
- Chrome 116 or later, Firefox desktop 140 or later.
- Text only. Images aren't sent to the model, and scanned PDFs without a text layer can't be read. PDFs larger than 30 MB or protected by a password can't be read.
- Local files, browser pages, extension stores and other extensions' pages can't be read.
- Each pin holds at most 200,000 characters. When pages and history exceed the provider's context budget, older history is dropped and page text is shortened.
- The model can't search the web or use tools. It sees only the pages you give it.
- No sync between devices, no export or import, no search across sessions.

Privacy policy: https://github.com/wolffischer82/Browser-Sidekick/blob/main/PRIVACY.md
Source code and issues: https://github.com/wolffischer82/Browser-Sidekick
Contact: feedback@findach.de
```

## Category

- Chrome Web Store: **Productivity**, subcategory **Tools** (the dashboard's category list may have changed; pick the closest match).
- AMO: **Other** (AMO's category list may have changed; no other category fits better today).

## Support

- Support URL: https://github.com/wolffischer82/Browser-Sidekick/issues
- Support email: feedback@findach.de

## Homepage

```text
https://github.com/wolffischer82/Browser-Sidekick
```

## Screenshots and promo tile

In `docs/store/assets/`, regenerated with `npm run store:assets`:

- `screenshot-1-answer.en.png`: a session with three pinned pages and an answer with citations.
- `screenshot-2-summary.en.png`: a summary of the pinned pages.
- `screenshot-3-sessions.en.png`: the sessions list.
- `screenshot-4-settings.en.png`: settings with two providers.
- `promo-small.en.png`: the small promo tile (440×280).
