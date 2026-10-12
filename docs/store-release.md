# Store release

How Browser Sidekick gets into the Chrome Web Store (CWS) and onto addons.mozilla.org (AMO): what to do once by hand, what to paste into each dashboard field, and how later releases go out automatically.

Repository after the move: `https://github.com/browser-sidekick/Browser-Sidekick` (see step 0). All URLs below assume it.

## 0. Before the first upload

1. **GitHub organisation.** Create a free organisation `browser-sidekick` (github.com → your avatar → Your organizations → New organization → Free). Then in this repo: Settings → General → Danger Zone → Transfer → `browser-sidekick`. Afterwards:
   - `git remote set-url origin https://github.com/browser-sidekick/Browser-Sidekick.git`
   - Settings → Actions → Runners: check that the `lenovo-ai-server` runner is still listed; if not, register it again for the new repo (or once for the organisation).
   - Org → People: leave your membership **private** (the default), so the org page doesn't show your handle.
2. **Support email.** Both stores want a contact address, and CWS shows it on the listing. Use a dedicated mailbox rather than your personal one, for example a new free address such as `browser.sidekick.ext@gmail.com`, or a forwarding alias (addy.io, SimpleLogin, Proton). Below it is `<support email>`.
3. **Merge this branch to `main`**, so `PRIVACY.md` and `LICENSE` are live at the URLs the listings point to.
4. **Build the zips:** `npm ci && npm run zip`. The files go to `dist/` (gitignored):
   - `browser-sidekick-<version>-chrome.zip`: upload to CWS
   - `browser-sidekick-<version>-firefox.zip`: upload to AMO
   - `browser-sidekick-<version>-sources.zip`: AMO source code upload
5. **Images:** `store/screenshots/` (regenerate with `npm run build:chrome && npm run store:screens`):
   - `1-ask.png`, `2-summarize.png`, `3-providers.png`, `4-dark.png`: 1280×800, for both stores
   - `promo-small-440x280.png`: CWS small promo tile
   - `promo-marquee-1400x560.png`: CWS marquee (optional)
   - Store icon: `public/icon/128.png`

The Firefox ID `browser-sidekick@browser-sidekick.github.io` becomes permanent with the first AMO upload.

## 1. Chrome Web Store

Register at <https://chrome.google.com/webstore/devconsole> ($5 once). Use the Google account you want to own the extension; a fresh one keeps it separate from your personal account.

### Account tab

| Field                    | Value                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| Publisher name           | `Browser Sidekick`                                                           |
| Contact email            | `<support email>` (must be verified)                                         |
| Trader / non-trader (EU) | **Non-trader**: a free hobby project. Traders must publish a postal address. |

### New item

Upload the chrome zip, then fill in the tabs.

### Store listing tab

| Field              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Description        | see "Description (EN)" below                                             |
| Category           | Productivity → Tools                                                     |
| Language           | English (then add German under "Localized listings": "Description (DE)") |
| Store icon         | `public/icon/128.png`                                                    |
| Screenshots        | the four 1280×800 PNGs, in order                                         |
| Small promo tile   | `promo-small-440x280.png`                                                |
| Marquee promo tile | `promo-marquee-1400x560.png` (optional)                                  |
| Official URL       | leave empty (needs a verified domain)                                    |
| Homepage URL       | `https://github.com/browser-sidekick/Browser-Sidekick`                   |
| Support URL        | `https://github.com/browser-sidekick/Browser-Sidekick/issues`            |
| Mature content     | No                                                                       |

Name and summary come from the manifest ("Browser Sidekick", "Pin pages to a session and ask your own LLM about them.", German from `_locales/de`).

### Privacy tab

**Single purpose description**

> Browser Sidekick lets the user collect web pages in a sidebar session and ask an LLM provider of their own choosing questions about those pages, or have them summarised.

**Permission justifications**

| Permission                                                                                    | Justification                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                                                     | Stores sessions, pinned page text, chat history and the user's provider settings and API keys locally on the device.                                                                                                                                                            |
| `activeTab`                                                                                   | Reads the page the user is looking at when they open the sidebar or use the context menu, without needing access to all sites.                                                                                                                                                  |
| `scripting`                                                                                   | Injects the text extractor into a page only when the user pins it or asks about it, to read its readable text, YouTube transcript or title.                                                                                                                                     |
| `contextMenus`                                                                                | Adds the "Pin to Sidekick" item to the page context menu.                                                                                                                                                                                                                       |
| `offscreen`                                                                                   | Parses PDF files with the bundled pdf.js in an offscreen document, because the service worker has no DOM.                                                                                                                                                                       |
| `sidePanel`                                                                                   | The extension's whole interface is a side panel next to the page.                                                                                                                                                                                                               |
| Host permissions (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) | Sends the user's question and the pinned pages' text to the LLM provider the user configured, with the user's own API key.                                                                                                                                                      |
| Optional host permission `<all_urls>`                                                         | Optional, asked at runtime: lets the sidebar read the current tab on any site and refresh pinned pages, and reach an OpenAI-compatible server at an address the user enters (e.g. a local Ollama). Without it the extension still works through activeTab and the context menu. |

**Remote code:** No, I am not using remote code. (All code, including pdf.js, is in the package.)

**Data usage:** tick

- **Authentication information**: the user's API keys, stored locally and sent only to the provider they belong to.
- **Web history**: titles and URLs of pages the user pins or asks about.
- **Website content**: the text of those pages.

Leave everything else unticked. Tick all three certifications (no selling, no unrelated use, no creditworthiness use).

**Privacy policy URL:** `https://github.com/browser-sidekick/Browser-Sidekick/blob/main/PRIVACY.md`

### Distribution tab

Free · Public · All regions.

Then **Submit for review**. You can choose "Publish automatically after review" or a manual publish.

## 2. Firefox Add-ons (AMO)

Create an account at <https://addons.mozilla.org>. Under Edit Profile, set the display name to `Browser Sidekick` (the username can be anything); the listing shows that name as the author.

Developer Hub → Submit a New Add-on:

1. **Distribution:** On this site (listed).
2. **Upload:** the firefox zip. Compatible platforms: **Firefox only**, untick Android (`strict_min_version` 140, desktop).
3. **Source code:** Yes → upload the sources zip.
4. **Describe your add-on:**

| Field             | Value                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name              | Browser Sidekick (from the manifest)                                                                                                                                                                                      |
| Add-on URL        | `browser-sidekick`                                                                                                                                                                                                        |
| Summary (≤250)    | Pin the pages you're reading into a session, then ask your own LLM about them or have it summarise them. Works with Anthropic, Google Gemini, any OpenAI-compatible API or a local model. Your data stays on your device. |
| Description       | "Description (EN)" below                                                                                                                                                                                                  |
| Categories        | Other; Tabs                                                                                                                                                                                                               |
| Support email     | `<support email>`                                                                                                                                                                                                         |
| Support website   | `https://github.com/browser-sidekick/Browser-Sidekick/issues`                                                                                                                                                             |
| License           | MIT License                                                                                                                                                                                                               |
| Privacy policy    | tick "This add-on has a privacy policy" and paste the English part of `PRIVACY.md`                                                                                                                                        |
| Notes to reviewer | "Notes to the AMO reviewer" below                                                                                                                                                                                         |

After submitting, open **Edit Product Page** to add the four screenshots and the homepage `https://github.com/browser-sidekick/Browser-Sidekick`, and a German translation (switch the locale at the top: name, summary, description DE).

The data-collection declaration (`websiteContent`, `browsingActivity`) comes from the manifest, and Firefox shows it at install.

### Notes to the AMO reviewer

```
Build from the uploaded sources (any OS; tested on Linux):
  Node.js 20.19 or later, npm 10 or later
  npm ci
  npm run build:firefox
The add-on is written to dist/firefox-ext/ and is identical to the uploaded package.

Bundled third-party code, unmodified from npm (versions pinned in package-lock.json):
  pdf.worker.js = node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs (pdfjs-dist 5.5.207)
  The main bundle includes @mozilla/readability, DOMPurify, marked, idb and preact.
  Model output is rendered as Markdown and sanitised with DOMPurify.

Testing: the add-on needs an LLM provider. Settings (sliders icon) → Add provider.
Without a paid key, an OpenAI-compatible local server works, e.g. Ollama:
  base URL http://localhost:11434/v1, no key.
Then open any article, click "Pin" in the sidebar and ask a question.

No remote code, no analytics. Network requests go only to the provider the user
configures and to the page being read (PDF files, YouTube transcripts).
```

## 3. Listing texts

### Description (EN)

```
Browser Sidekick is a sidebar for reading with an LLM at your side.

Pin the pages you're reading into a session, then ask questions about them or have them summarised. Answers stream in and cite their sources by number; click a number to jump to that page.

FEATURES
• Sessions of pinned pages: pin the current tab from the sidebar, or right-click any page and choose "Pin to Sidekick". Rename, switch and delete sessions.
• Web pages, YouTube videos and PDFs: articles are reduced to their readable text, videos to their transcript, PDFs to their text layer.
• Ask and summarise: answers draw on the pinned pages plus the tab you're on. Summarize gives a short summary per page and an overall one.
• Your own provider and key: Anthropic, Google Gemini, or any OpenAI-compatible API (OpenAI, OpenRouter, Groq), or a local model server such as Ollama or LM Studio. Save several providers and pick the model per session.
• Thinking level per session, and the model's reasoning on demand.
• English and German interface; light and dark mode.

PRIVACY
Sessions, pinned pages, chat history and API keys stay on your device. Page text goes only to the provider you chose, and only when you ask or summarise. There is no telemetry and no server of ours. Access to all websites is optional.

You need an API key from a provider, or a local model server. Open source (MIT): https://github.com/browser-sidekick/Browser-Sidekick
```

### Description (DE)

```
Browser Sidekick ist eine Seitenleiste, mit der du beim Lesen ein Sprachmodell an deiner Seite hast.

Hefte die Seiten, die du liest, an eine Sitzung an und stell Fragen dazu oder lass sie zusammenfassen. Antworten erscheinen live und nennen ihre Quellen mit Nummern; ein Klick auf eine Nummer öffnet die Seite.

FUNKTIONEN
• Sitzungen mit angehefteten Seiten: den aktuellen Tab in der Seitenleiste anheften oder per Rechtsklick „An Sidekick anheften“. Sitzungen umbenennen, wechseln und löschen.
• Webseiten, YouTube-Videos und PDFs: Artikel werden auf ihren lesbaren Text reduziert, Videos auf ihr Transkript, PDFs auf ihre Textebene.
• Fragen und zusammenfassen: Antworten stützen sich auf die angehefteten Seiten und den aktuellen Tab. „Zusammenfassen“ liefert eine kurze Zusammenfassung pro Seite und eine Gesamtübersicht.
• Eigener Anbieter, eigener Schlüssel: Anthropic, Google Gemini oder jede OpenAI-kompatible API (OpenAI, OpenRouter, Groq) oder ein lokaler Modellserver wie Ollama oder LM Studio. Mehrere Anbieter speichern und das Modell pro Sitzung wählen.
• Denkstufe pro Sitzung und auf Wunsch die Überlegungen des Modells.
• Oberfläche auf Deutsch und Englisch, heller und dunkler Modus.

DATENSCHUTZ
Sitzungen, angeheftete Seiten, Verlauf und API-Schlüssel bleiben auf deinem Gerät. Seitentext geht nur an den Anbieter, den du gewählt hast, und nur, wenn du fragst oder zusammenfassen lässt. Keine Telemetrie, kein eigener Server. Der Zugriff auf alle Websites ist optional.

Du brauchst einen API-Schlüssel eines Anbieters oder einen lokalen Modellserver. Open Source (MIT): https://github.com/browser-sidekick/Browser-Sidekick
```

### Summary (DE, AMO)

```
Hefte die Seiten, die du liest, an eine Sitzung an und frag dein eigenes LLM dazu oder lass sie zusammenfassen. Mit Anthropic, Google Gemini, jeder OpenAI-kompatiblen API oder einem lokalen Modell. Deine Daten bleiben auf deinem Gerät.
```

## 4. Automatic releases

After both stores have accepted the first version, later versions go out from CI (`.github/workflows/release.yml`).

### Credentials (once)

**Chrome:** in the Google account that owns the extension, open <https://console.cloud.google.com>:

1. Create a project, then APIs & Services → Library → enable **Chrome Web Store API**.
2. OAuth consent screen: External; add yourself as a test user, then **Publish app** (to "In production"). Refresh tokens of apps left in "Testing" expire after 7 days.
3. Credentials → Create OAuth client ID.
4. Run `npx wxt submit init`, choose Chrome, enter the client ID and secret, and follow the browser sign-in. It prints the refresh token. The extension ID is shown in the CWS dashboard.

**Firefox:** <https://addons.mozilla.org/developers/addon/api/key/> → Generate new credentials. The JWT issuer and JWT secret are shown once. The extension ID is `browser-sidekick@browser-sidekick.github.io`.

Store them as repository secrets (Settings → Secrets and variables → Actions, or `gh secret set NAME`):

| Secret                 | Value                                         |
| ---------------------- | --------------------------------------------- |
| `CHROME_EXTENSION_ID`  | 32-letter ID from the CWS dashboard           |
| `CHROME_CLIENT_ID`     | OAuth client ID                               |
| `CHROME_CLIENT_SECRET` | OAuth client secret                           |
| `CHROME_REFRESH_TOKEN` | from `wxt submit init`                        |
| `FIREFOX_EXTENSION_ID` | `browser-sidekick@browser-sidekick.github.io` |
| `FIREFOX_JWT_ISSUER`   | AMO API key ("JWT issuer")                    |
| `FIREFOX_JWT_SECRET`   | AMO API secret                                |

Check them without uploading: Actions → Release → Run workflow (dry run ticked).

### Each release

1. Bump `version` in `package.json`, rebuild and commit `dist/` as usual, merge to `main`.
2. `git tag v<version> && git push origin v<version>`.
3. The workflow lints, tests, zips, checks that `dist/` matches, and submits both zips (plus the sources zip to AMO) for review. Both stores review every version; you get their emails.

From a checkout instead of CI: `npm run zip && npm run submit`, with the same variables in `.env.submit` (gitignored by `.env.*`).
