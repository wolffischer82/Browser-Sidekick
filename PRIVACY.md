# Privacy policy

Browser Sidekick · last updated 12 October 2026

Browser Sidekick is a browser extension that lets you pin web pages to a session and ask a large language model (LLM) of your choice about them. It has no server of its own and no telemetry. The authors of the extension receive no data from it.

## What the extension handles

- **Page content and addresses.** When you pin a page, or when you ask a question or press Summarize while a page is open, the extension reads that page's text, title and URL. For YouTube videos it reads the transcript, and for PDFs their text layer.
- **Your questions and the answers** you get, kept as chat history per session.
- **Provider settings**, including the API keys you enter.
- **Titles and URLs of your open tabs**, shown in the sidebar so you can pin them. They are read on demand and are not stored unless you pin a page.

## Where it goes

- Everything above is stored **only on your device**, in the extension's local browser storage. Nothing is synced or sent to the authors.
- When you ask a question or press Summarize, the text, titles and URLs of the pages in the session, your question and the earlier messages of the session are sent **directly from your browser to the LLM provider you configured** (for example Anthropic, Google Gemini, OpenAI, OpenRouter, or a server you run yourself). Your API key is sent to that provider only, to authenticate. That provider's own privacy policy applies to what it receives.
- To read a page, the extension may request it again from the site it came from (for example a PDF file, or a YouTube transcript from youtube.com).
- Nothing is sent anywhere until you pin a page, ask, or summarize. There are no analytics, advertising, or tracking, and data is never sold or shared with anyone else.

## Your control

- Delete single sessions in the sidebar, or everything under Settings → Delete all data (optionally including providers and API keys).
- Uninstalling the extension removes all of its stored data.
- Access to all websites is optional and can be withdrawn in your browser's extension settings at any time.

## Contact

Questions about this policy: open an issue at https://github.com/browser-sidekick/Browser-Sidekick/issues.

---

# Datenschutzerklärung

Browser Sidekick · Stand: 12. Oktober 2026

Browser Sidekick ist eine Browser-Erweiterung, mit der du Webseiten an eine Sitzung anheftest und ein Sprachmodell (LLM) deiner Wahl dazu befragst. Sie hat keinen eigenen Server und keine Telemetrie. Die Autoren der Erweiterung erhalten keine Daten.

## Welche Daten die Erweiterung verarbeitet

- **Seiteninhalte und Adressen.** Wenn du eine Seite anheftest oder eine Frage stellst bzw. auf „Zusammenfassen“ klickst, während eine Seite geöffnet ist, liest die Erweiterung Text, Titel und URL dieser Seite. Bei YouTube-Videos das Transkript, bei PDFs die Textebene.
- **Deine Fragen und die Antworten**, als Verlauf pro Sitzung.
- **Anbieter-Einstellungen** einschließlich der API-Schlüssel, die du einträgst.
- **Titel und URLs deiner offenen Tabs**, damit du sie in der Seitenleiste anheften kannst. Sie werden nur bei Bedarf gelesen und nur gespeichert, wenn du eine Seite anheftest.

## Wohin die Daten gehen

- Alles oben Genannte wird **nur auf deinem Gerät** im lokalen Speicher der Erweiterung abgelegt. Nichts wird synchronisiert oder an die Autoren gesendet.
- Wenn du eine Frage stellst oder zusammenfassen lässt, werden Text, Titel und URLs der Seiten der Sitzung, deine Frage und die bisherigen Nachrichten der Sitzung **direkt von deinem Browser an den von dir eingerichteten LLM-Anbieter** gesendet (z. B. Anthropic, Google Gemini, OpenAI, OpenRouter oder ein eigener Server). Dein API-Schlüssel geht nur an diesen Anbieter, zur Anmeldung. Für die Daten dort gilt dessen Datenschutzerklärung.
- Um eine Seite zu lesen, kann die Erweiterung sie erneut von der Website abrufen, von der sie stammt (z. B. eine PDF-Datei oder ein Transkript von youtube.com).
- Es wird nichts gesendet, bevor du eine Seite anheftest, fragst oder zusammenfassen lässt. Es gibt keine Analyse, keine Werbung und kein Tracking; Daten werden weder verkauft noch an Dritte weitergegeben.

## Deine Kontrolle

- Lösche einzelne Sitzungen in der Seitenleiste oder alles unter Einstellungen → Alle Daten löschen (wahlweise mit Anbietern und API-Schlüsseln).
- Beim Deinstallieren werden alle gespeicherten Daten der Erweiterung entfernt.
- Der Zugriff auf alle Websites ist optional und lässt sich jederzeit in den Erweiterungseinstellungen des Browsers entziehen.

## Kontakt

Fragen zu dieser Erklärung: Issue unter https://github.com/browser-sidekick/Browser-Sidekick/issues.
