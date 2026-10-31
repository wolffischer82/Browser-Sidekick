# Store listing (German)

The German texts for the store forms' German language entry. Section headings and notes are in English like the rest of `docs/store/`; the text blocks are what the stores show. Copy each block as it is; the stores show line breaks but no Markdown. The character limits are checked by `tests/store-listing.test.ts`.

## Name

```text
Browser Sidekick
```

Both stores take the name from the extension's manifest (`extName` in `public/_locales/de/messages.json`).

## Chrome short description

At most 132 characters. The Chrome Web Store takes this summary from the manifest's `description`, which is `extDescription` in `public/_locales/de/messages.json`, and, at the time of writing, doesn't let you edit it in the dashboard. This text is that string, so the listing and the package agree.

```text
Hefte Seiten an eine Sitzung an und frag dein eigenes LLM dazu.
```

## AMO summary

At most 250 characters.

```text
Frag dein eigenes LLM in der Seitenleiste zu den Seiten, die du liest. Hefte Webseiten, YouTube-Videos und PDFs an Sitzungen an, stell Fragen oder lass zusammenfassen, mit nummerierten Quellen. Für Anthropic, Google Gemini und OpenAI-kompatible APIs.
```

## Full description

```text
Browser Sidekick ist eine Seitenleiste für Chrome und Firefox. Hefte die Seiten, die du gerade liest, an eine Sitzung an und frag dann dein eigenes LLM dazu oder lass sie zusammenfassen.

WAS SIE KANN

- Sitzungen mit angehefteten Seiten: Hefte den aktuellen Tab aus der Seitenleiste an oder klick mit der rechten Maustaste auf eine Seite und wähle „An Sidekick anheften“. Jeder Pin speichert eine Momentaufnahme des Seitentexts, die du aktualisieren kannst, solange der Tab offen ist. Sitzungen bleiben erhalten, bis du sie löschst, und du kannst zwischen ihnen wechseln und sie umbenennen.
- Webseiten, YouTube und PDFs: Artikel werden auf ihren lesbaren Text reduziert, YouTube-Videos auf ihr Transkript und PDFs auf ihre Textebene.
- Fragen und zusammenfassen: Fragen werden anhand der angehefteten Seiten und des Tabs beantwortet, auf dem du bist. „Zusammenfassen“ liefert eine kurze Zusammenfassung je Seite und eine Gesamtzusammenfassung. Antworten erscheinen nach und nach und nennen ihre Quellen mit Nummern; ein Klick auf eine Nummer öffnet die Seite.
- Dein eigener Anbieter und Schlüssel: funktioniert mit Anthropic, Google Gemini und jeder OpenAI-kompatiblen API (OpenAI, OpenRouter, Groq oder ein lokaler Server wie Ollama oder LM Studio). Du kannst mehrere Anbieter speichern und das Modell je Sitzung wählen.
- Denkstufe je Sitzung: Wähle, wie viel das Modell vor der Antwort nachdenken soll (Standard, Niedrig, Mittel oder Hoch), bei Modellen, die das unterstützen.
- Gedankengang auf Wunsch: Wenn das Modell seinen Gedankengang liefert, kannst du ihn über der Antwort aufklappen.
- Lokale Daten: Sitzungen, Pins, Chatverlauf und API-Schlüssel bleiben auf deinem Gerät. Seitentext geht nur an den Anbieter, den du gewählt hast, und nur, wenn du fragst oder zusammenfassen lässt. Es gibt keine Telemetrie.
- Wenige Berechtigungen: Der Zugriff auf alle Websites ist optional. Ohne ihn kann die Erweiterung trotzdem eine Seite lesen, die du über das Rechtsklickmenü anheftest.
- Oberfläche auf Deutsch und Englisch, je nach Sprache des Browsers.

GRENZEN

- Du brauchst einen API-Schlüssel oder einen lokalen Modellserver. Es ist kein Modell eingebaut.
- Chrome ab Version 116, Firefox für den Desktop ab Version 140.
- Nur Text. Bilder werden nicht an das Modell gesendet, und gescannte PDFs ohne Textebene können nicht gelesen werden. PDFs über 30 MB oder mit Passwortschutz können nicht gelesen werden.
- Lokale Dateien, Browser-Seiten, Erweiterungs-Stores und Seiten anderer Erweiterungen können nicht gelesen werden.
- Jeder Pin fasst höchstens 200.000 Zeichen. Wenn Seiten und Verlauf das Kontextbudget des Anbieters überschreiten, wird älterer Verlauf weggelassen und Seitentext gekürzt.
- Das Modell kann nicht im Web suchen und keine Werkzeuge nutzen. Es sieht nur die Seiten, die du ihm gibst.
- Keine Synchronisierung zwischen Geräten, kein Export oder Import, keine Suche über Sitzungen hinweg.

Datenschutzerklärung: https://github.com/wolffischer82/Browser-Sidekick/blob/main/PRIVACY.de.md
Quellcode und Issues: https://github.com/wolffischer82/Browser-Sidekick
Kontakt: feedback@findach.de
```

## Category

The category is chosen once per listing, not per language; see `listing.en.md`.

## Support

- Support URL: https://github.com/wolffischer82/Browser-Sidekick/issues
- Support email: feedback@findach.de

## Homepage

```text
https://github.com/wolffischer82/Browser-Sidekick
```

## Screenshots and promo tile

In `docs/store/assets/`, regenerated with `npm run store:assets`:

- `screenshot-1-answer.de.png`: eine Sitzung mit drei angehefteten Seiten und einer Antwort mit Quellen.
- `screenshot-2-summary.de.png`: eine Zusammenfassung der angehefteten Seiten.
- `screenshot-3-sessions.de.png`: die Liste der Sitzungen.
- `screenshot-4-settings.de.png`: die Einstellungen mit zwei Anbietern.
- `promo-small.de.png`: die kleine Promo-Kachel (440×280).
