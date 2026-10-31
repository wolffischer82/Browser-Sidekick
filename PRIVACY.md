# Privacy policy

Browser Sidekick is a browser extension for Chrome and Firefox. You pin web pages into sessions and ask an LLM provider of your choice about them. This policy describes what the extension does with your data. It applies to version 0.1.0 and later until it is changed.

Effective date: 31 October 2026.

A German version is in [PRIVACY.de.md](PRIVACY.de.md).

## Summary

- Your data stays on your device, in the extension's own storage.
- Page text, your questions and the conversation go only to the LLM provider you set up, and only when you ask a question or press Summarize.
- The developer receives nothing. There is no telemetry, no analytics, no advertising and no remote code. No data is sold or passed on.

## What is stored on your device

The extension stores the following in the browser's extension storage and in an IndexedDB database belonging to the extension:

- **Sessions:** title, the chosen provider, model and thinking level, and when the session was created and last used.
- **Pinned pages:** the address (URL), title and icon address of each page you pin, the text read from it (article text, a YouTube transcript or a PDF's text, at most 200,000 characters), and when it was read.
- **Chat history:** your questions, the answers, the model's reasoning when the provider returns it, and the title and URL of each page a question was sent with, so that citations keep working. When you ask about the tab you're on without pinning it, its title and URL are kept with the question; its text is not stored.
- **Settings:** your providers (name, type, API address, API key, default model, context budget and the list of models the provider returned), the default provider, the active session and two display choices.

API keys are stored unencrypted in the extension's local storage. Nothing is stored in the browser's sync storage, so nothing is copied to other devices by the extension.

The data is kept until you delete it. You can unpin a page, delete a session with its pages and history, delete a provider with its API key, or use "Delete all data" in the settings (optionally including providers and API keys). Removing the extension deletes all of it.

## What leaves your device

The extension contacts the following, and nothing else:

**The LLM provider you set up.** When you ask a question or press Summarize, the extension sends one request to that provider. It contains the text, title and URL of the pinned pages, and of the tab you're on unless it is already pinned or you excluded it; the conversation so far; and your question or the summary request. After the first answer in a session, one more request sends your first question and the beginning of the answer to the same provider to get a short session title. In the provider settings, "Load models" asks the provider for its list of models, and "Test connection" sends the word "Hi". Your API key is sent to the provider with each of these requests.

The providers are:

- Anthropic: `api.anthropic.com`
- Google Gemini: `generativelanguage.googleapis.com`
- OpenAI: `api.openai.com`
- Any other OpenAI-compatible address you enter yourself, for example OpenRouter, Groq or a server on your own computer.

Nothing is sent to a provider you have not set up. Once data reaches a provider, that provider's own privacy policy and terms apply.

**The sites you read.** To read a page, the extension takes its text from the open tab. For a PDF, it downloads the file again from the PDF's own address, without cookies. For a YouTube video, it requests the video page and its transcript from YouTube within the open YouTube tab, as YouTube's own "Show transcript" does. The sidebar shows each page's icon from the address the browser reports for it.

## What the developer receives

Nothing. The extension has no server, no account, no telemetry, no analytics, no crash reporting and no advertising. It does not load or run code from the internet; all its code is part of the installed package. The developer does not sell, rent or transfer your data to anyone and cannot see it.

## Permissions

- **Storage** (`storage`): keeps your settings, providers and API keys on your device.
- **Active tab** (`activeTab`): lets the extension read the page you are on after you click its toolbar icon or "Pin to Sidekick".
- **Scripting** (`scripting`): runs the code that reads a page's text in that tab, only when you pin, refresh or ask about it.
- **Context menus** (`contextMenus`): adds "Pin to Sidekick" to the right-click menu.
- **Side panel** (`sidePanel`, Chrome only): shows the extension in the browser's side panel. Firefox uses its sidebar, which needs no permission.
- **Offscreen document** (`offscreen`, Chrome only): reads the text of a pinned PDF in the background. Firefox does this in the extension's background page.
- **Access to `api.anthropic.com`, `generativelanguage.googleapis.com` and `api.openai.com`**: sends your requests to these providers when you have set them up.
- **Optional access to all sites or to one site:** the browser asks you first. Access to all sites is requested when you choose "Allow on all sites" in the sidebar or the settings; access to one site when you pin a page of that site from the sidebar. It lets the extension see the address of the tab you're on and read the pages you pin, refresh or ask about. Without it, pages can still be pinned from the right-click menu. You can withdraw it at any time in the browser's extension settings.
- **Optional access to a custom provider address:** asked for when you save an OpenAI-compatible provider with an address other than the ones above, so that requests can be sent to it.

In Firefox, the extension declares that it handles website content and browsing activity. This refers to the page text and page addresses sent to your own provider as described above.

## Changes and contact

Changes to this policy are made in this file. Its full history is visible in the repository on GitHub.

Questions or concerns: open an issue at <https://github.com/wolffischer82/Browser-Sidekick/issues>.
