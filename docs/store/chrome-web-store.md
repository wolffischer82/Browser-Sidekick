# Chrome Web Store: privacy practices

Texts for the "Privacy practices" tab of the Chrome Web Store developer dashboard. The listing texts (description, category, screenshots) are in `listing.en.md` and `listing.de.md`. Every statement here follows `PRIVACY.md`; if the two ever disagree, the policy and the code win and this file is corrected.

The field names below are the dashboard's at the time of writing. If the dashboard has changed, match the fields by meaning.

## Single purpose

```text
Browser Sidekick lets you pin web pages into sessions in the browser's side panel and ask an LLM provider of your own choice about them, or have it summarise them.
```

## Permission justifications

The permissions in `dist/chrome-ext/manifest.json`: `storage`, `activeTab`, `scripting`, `contextMenus`, `offscreen`, `sidePanel`; host permissions for the three built-in provider APIs; optional host permission `<all_urls>`.

### storage

```text
Keeps the user's settings, LLM providers and API keys in the extension's local storage on the device. Sessions, pinned page text and chat history are kept in the extension's IndexedDB database. Nothing is stored in sync storage.
```

### activeTab

```text
Lets the extension read the page the user is on after they click the toolbar icon or choose "Pin to Sidekick" in the right-click menu, without asking for access to all sites.
```

### scripting

```text
Runs the code that reads a page's text (article text, a YouTube transcript) in that tab, only when the user pins a page, refreshes a pin or asks about the current tab.
```

### contextMenus

```text
Adds "Pin to Sidekick" to the right-click menu of pages, so a page can be pinned to the current session even without access to all sites.
```

### offscreen

```text
Reads the text of a pinned PDF in an offscreen document, because the service worker can't start the worker of the bundled PDF reader (pdf.js). The PDF is downloaded again from its own address without cookies. The document is closed when no PDF is left to read.
```

### sidePanel

```text
Shows the extension's user interface (sessions, pinned pages, chat and settings) in the browser's side panel.
```

### Host permissions

This field covers both the required and the optional host permissions.

```text
api.openai.com, api.anthropic.com and generativelanguage.googleapis.com: the extension sends the user's request to the LLM provider they have set up (OpenAI, Anthropic or Google Gemini) when they ask a question, press Summarize, load the provider's model list or test the connection. Nothing is sent to a provider the user has not set up.

Optional <all_urls>: requested only when the user chooses "Allow on all sites" in the side panel or the settings, and for a single site when they pin a page of that site from the side panel; the browser asks first. It lets the extension see the address of the current tab and read the pages the user pins, refreshes or asks about. Without it, pages can still be pinned through the right-click menu. The same optional permission covers a custom OpenAI-compatible provider address (for example a local server) that the user enters; it is requested for that address when the provider is saved.
```

## Remote code

Answer: **No, I am not using remote code.**

```text
All JavaScript, including the PDF reader (pdf.js and its worker) and the fonts, is part of the package. The extension does not load or run code from the internet.
```

## Data usage

The extension handles the following. Tick these boxes and no others:

- **Web history**: the address (URL) and title of each pinned page, and of the current tab when a question is asked about it. They are stored on the device and sent to the user's own LLM provider with the question.
- **Website content**: the text read from pinned pages and the current tab (article text, YouTube transcripts, PDF text). It is stored on the device and sent to the user's own LLM provider when the user asks a question or presses Summarize.

These are the same two categories the Firefox package declares in `data_collection_permissions` (`browsingActivity`, `websiteContent`). The API key and the user's questions and the answers are stored on the device and sent only to the provider the user set up; they are not ticked as "Authentication information" or "Personal communications" (see `docs/questions.md`, Store publishing).

Not handled: personally identifiable information, health information, financial and payment information, location, user activity (clicks, mouse position, scrolling, keystroke logging).

### Certifications

Tick all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

The only transfer is the one the user starts: page text, page addresses and the question go to the LLM provider the user configured, to answer that question. The developer receives nothing; there is no telemetry, analytics or advertising.

## Privacy policy URL

```text
https://github.com/wolffischer82/Browser-Sidekick/blob/main/PRIVACY.md
```

## Contact

- Contact email for the developer account and the listing: feedback@findach.de
- Support URL: https://github.com/wolffischer82/Browser-Sidekick/issues
