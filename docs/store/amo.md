# addons.mozilla.org (AMO)

Texts for the AMO developer hub. The field names below are AMO's at the time of writing; if the forms have changed, match the fields by meaning. Every statement follows `PRIVACY.md`.

## Listing

- **Name:** taken from the package (`Browser Sidekick`).
- **Summary:** "AMO summary" in `listing.en.md`; for the German locale, the same section in `listing.de.md`.
- **Description:** "Full description" in `listing.en.md` and `listing.de.md`.
- **Categories:** see "Category" in `listing.en.md`.
- **Homepage:** https://github.com/wolffischer82/Browser-Sidekick
- **Support email:** feedback@findach.de
- **Support website:** https://github.com/wolffischer82/Browser-Sidekick/issues
- **Screenshots:** the `screenshot-*.en.png` files in `assets/` (and the `.de.png` files for the German locale). AMO doesn't use the promo tile.
- **Licence:** MIT ("The MIT License" in AMO's list). The text is in `LICENSE`.
- **Compatibility:** Firefox for desktop only; leave Firefox for Android unticked. The package requires Firefox 140 or later (`strict_min_version`).

## Privacy policy

AMO takes the policy as text, not as a URL. Paste the whole of `PRIVACY.md` into the English privacy policy field, and `PRIVACY.de.md` into the German one. Check AMO's preview: if Markdown marks (`**`, backticks) show literally, remove only those marks; the wording stays as in the file.

## Data collection permissions

The Firefox package declares in `browser_specific_settings.gecko.data_collection_permissions` (set in `wxt.config.ts`):

```json
{ "required": ["websiteContent", "browsingActivity"] }
```

- `websiteContent`: the text read from pinned pages and the current tab (article text, YouTube transcripts, PDF text). It is sent to the LLM provider the user set up, when they ask a question or press Summarize.
- `browsingActivity`: the address (URL) and title of each pinned page, and of the current tab when a question is asked about it, sent with that text.

Both are `required` because asking about pages is the add-on's only purpose; nothing works without them. Nothing goes to the developer: there is no telemetry, analytics or crash reporting, so `technicalAndInteraction` is not declared. Firefox shows both categories when the add-on is installed. These are the same two categories ticked in the Chrome Web Store form (`chrome-web-store.md`).

## Notes to reviewer

Paste into "Notes to Reviewer":

```text
Browser Sidekick is a sidebar for asking an LLM about web pages. The user pins pages into sessions (sidebar pin button, or "Pin to Sidekick" in the right-click menu) and asks questions or presses Summarize. Answers cite the pinned pages by number.

No account with the developer is needed, and the add-on sends nothing to the developer. To try questions and summaries, the add-on needs an LLM provider set up by the user. The simplest way without a paid key is a local OpenAI-compatible server, for example Ollama:
1. Install Ollama, pull a small model (for example "ollama pull llama3.2"), and start it so that it accepts requests from the add-on: OLLAMA_ORIGINS="moz-extension://*" ollama serve
2. Open the sidebar (toolbar icon), then Settings (sliders icon at the top right) > Add provider.
3. Type: OpenAI-compatible. Name: any. Base URL: http://localhost:11434/v1. API key: leave empty.
4. Press "Load models", choose the model, press Save. When Firefox asks for access to localhost, allow it.
5. Open any article, press the pin button on the current tab row (Firefox asks for access to that site; or use "Pin to Sidekick" in the right-click menu), and ask a question.
Any other OpenAI-compatible endpoint, or an Anthropic, Google Gemini or OpenAI key, works the same way.

Access to all sites is optional. It is requested only when the user chooses "Allow on all sites" in the sidebar or the settings. Without it, pages can be pinned from the right-click menu.

Source code: the uploaded sources zip rebuilds the package exactly. Build instructions are below and in README.md.
```

## Source code

AMO asks for the source because the package is built with a bundler (WXT/Vite) and contains minified third-party code (pdf.js). Upload `dist/browser-sidekick-<version>-sources.zip`, written by `npm run zip`. It contains only what the build needs: `src/`, `public/`, `package.json`, `package-lock.json`, `wxt.config.ts`, `tsconfig.json`, `LICENSE`, `README.md`.

Build instructions to paste with the upload:

```text
Build environment used for the submitted package:
- Operating system: Ubuntu 24.04 LTS, x86_64 (any system with the Node.js version below should give the same result)
- Node.js 22.23.4 (at least 20.19.0 is required)
- npm 10.9.9

Steps:
1. Unzip the sources zip into an empty directory and open a terminal there.
2. npm ci
   (installs the exact dependency versions from package-lock.json; needs network access to the npm registry)
3. npm run build:firefox

The add-on is written to dist/firefox-ext/. Its files are identical to the files in the submitted package.

Third-party code comes only from npm, as locked in package-lock.json. The PDF reader's worker (dist/firefox-ext/pdf.worker.js) is node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs, copied unchanged by the build. The Geist fonts are bundled from src/entrypoints/sidepanel/fonts (SIL Open Font License, assets/OFL.txt).
```

## Permissions (for reviewer questions)

The permissions in `dist/firefox-ext/manifest.json` and what each is for (the same as in `PRIVACY.md` "Permissions"):

- `storage`: keeps settings, providers and API keys on the device.
- `activeTab`: reads the page the user is on after they click the toolbar icon or "Pin to Sidekick".
- `scripting`: runs the code that reads a page's text in that tab, only when the user pins, refreshes or asks about it.
- `contextMenus`: adds "Pin to Sidekick" to the right-click menu.
- Host permissions `https://api.openai.com/*`, `https://api.anthropic.com/*`, `https://generativelanguage.googleapis.com/*`: send the user's requests to these providers when the user has set them up.
- Optional `<all_urls>`: asked for when the user chooses "Allow on all sites", for one site when they pin a page of that site from the sidebar, and for a custom provider address when they save such a provider. It lets the add-on see the address of the current tab and read the pages the user pins, refreshes or asks about.
- The sidebar (`sidebar_action`) needs no permission. PDFs are read in the background page; Firefox needs no `offscreen` permission.
