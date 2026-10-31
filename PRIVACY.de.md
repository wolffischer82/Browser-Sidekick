# Datenschutzerklärung

Browser Sidekick ist eine Browser-Erweiterung für Chrome und Firefox. Du heftest Webseiten an Sitzungen an und stellst einem LLM-Anbieter deiner Wahl Fragen dazu. Diese Erklärung beschreibt, was die Erweiterung mit deinen Daten macht. Sie gilt ab Version 0.1.0, bis sie geändert wird.

Gültig ab: 31. Oktober 2026.

Die englische Fassung steht in [PRIVACY.md](PRIVACY.md).

## Zusammenfassung

- Deine Daten bleiben auf deinem Gerät, im eigenen Speicher der Erweiterung.
- Seitentext, deine Fragen und der Gesprächsverlauf gehen nur an den LLM-Anbieter, den du eingerichtet hast, und nur, wenn du eine Frage stellst oder auf „Zusammenfassen“ klickst.
- Der Entwickler erhält nichts. Es gibt keine Telemetrie, keine Analyse, keine Werbung und keinen nachgeladenen Code. Es werden keine Daten verkauft oder weitergegeben.

## Was auf deinem Gerät gespeichert wird

Die Erweiterung speichert Folgendes im Erweiterungsspeicher des Browsers und in einer IndexedDB-Datenbank der Erweiterung:

- **Sitzungen:** Titel, der gewählte Anbieter, das Modell und die Denkstufe sowie wann die Sitzung angelegt und zuletzt benutzt wurde.
- **Angeheftete Seiten:** die Adresse (URL), der Titel und die Adresse des Symbols jeder angehefteten Seite, der daraus gelesene Text (Artikeltext, ein YouTube-Transkript oder der Text eines PDFs, höchstens 200.000 Zeichen) und wann er gelesen wurde.
- **Chatverlauf:** deine Fragen, die Antworten, den Gedankengang des Modells, wenn der Anbieter ihn liefert, sowie Titel und URL jeder Seite, mit der eine Frage gesendet wurde, damit Quellenangaben funktionieren. Fragst du zum aktuellen Tab, ohne ihn anzuheften, werden sein Titel und seine URL mit der Frage gespeichert, sein Text nicht.
- **Einstellungen:** deine Anbieter (Name, Art, API-Adresse, API-Schlüssel, Standardmodell, Kontextbudget und die Modellliste, die der Anbieter geliefert hat), der Standardanbieter, die aktive Sitzung und zwei Anzeigeoptionen.

API-Schlüssel werden unverschlüsselt im lokalen Speicher der Erweiterung abgelegt. Nichts wird im Synchronisierungsspeicher des Browsers abgelegt, die Erweiterung kopiert also nichts auf andere Geräte.

Die Daten bleiben gespeichert, bis du sie löschst. Du kannst eine Seite loslösen, eine Sitzung mit ihren Seiten und ihrem Verlauf löschen, einen Anbieter mit seinem API-Schlüssel löschen oder in den Einstellungen „Alle Daten löschen“ verwenden (wahlweise einschließlich Anbietern und API-Schlüsseln). Wenn du die Erweiterung entfernst, wird alles gelöscht.

## Was dein Gerät verlässt

Die Erweiterung nimmt Verbindung zu Folgendem auf und zu nichts anderem:

**Dem LLM-Anbieter, den du eingerichtet hast.** Wenn du eine Frage stellst oder auf „Zusammenfassen“ klickst, sendet die Erweiterung eine Anfrage an diesen Anbieter. Sie enthält Text, Titel und URL der angehefteten Seiten und des aktuellen Tabs, sofern er nicht schon angeheftet ist oder du ihn ausgeschlossen hast, den bisherigen Gesprächsverlauf und deine Frage oder die Bitte um Zusammenfassung. Nach der ersten Antwort einer Sitzung sendet eine weitere Anfrage deine erste Frage und den Anfang der Antwort an denselben Anbieter, um einen kurzen Sitzungstitel zu erhalten. In den Anbietereinstellungen fragt „Modelle laden“ den Anbieter nach seiner Modellliste, und „Verbindung testen“ sendet das Wort „Hi“. Dein API-Schlüssel wird bei jeder dieser Anfragen an den Anbieter übermittelt.

Die Anbieter sind:

- Anthropic: `api.anthropic.com`
- Google Gemini: `generativelanguage.googleapis.com`
- OpenAI: `api.openai.com`
- Jede andere OpenAI-kompatible Adresse, die du selbst einträgst, zum Beispiel OpenRouter, Groq oder ein Server auf deinem eigenen Computer.

An einen Anbieter, den du nicht eingerichtet hast, wird nichts gesendet. Sobald Daten bei einem Anbieter ankommen, gelten dessen eigene Datenschutzerklärung und Bedingungen.

**Den Websites, die du liest.** Um eine Seite zu lesen, nimmt die Erweiterung ihren Text aus dem geöffneten Tab. Ein PDF lädt sie von seiner eigenen Adresse erneut herunter, ohne Cookies. Für ein YouTube-Video ruft sie im geöffneten YouTube-Tab die Videoseite und ihr Transkript bei YouTube ab, so wie YouTubes eigene Funktion „Transkript anzeigen“. Die Seitenleiste zeigt das Symbol jeder Seite von der Adresse, die der Browser dafür meldet.

## Was der Entwickler erhält

Nichts. Die Erweiterung hat keinen Server, kein Konto, keine Telemetrie, keine Analyse, keine Absturzberichte und keine Werbung. Sie lädt und startet keinen Code aus dem Internet; ihr gesamter Code ist Teil des installierten Pakets. Der Entwickler verkauft, vermietet oder überträgt deine Daten an niemanden und kann sie nicht sehen.

## Berechtigungen

- **Speicher** (`storage`): bewahrt deine Einstellungen, Anbieter und API-Schlüssel auf deinem Gerät auf.
- **Aktiver Tab** (`activeTab`): erlaubt der Erweiterung, die Seite zu lesen, auf der du bist, nachdem du auf ihr Symbol in der Symbolleiste oder auf „An Sidekick anheften“ geklickt hast.
- **Skripte** (`scripting`): führt in diesem Tab den Code aus, der den Text einer Seite liest, nur wenn du sie anheftest, aktualisierst oder dazu fragst.
- **Kontextmenüs** (`contextMenus`): fügt „An Sidekick anheften“ zum Rechtsklickmenü hinzu.
- **Seitenleiste** (`sidePanel`, nur Chrome): zeigt die Erweiterung in der Seitenleiste des Browsers. Firefox nutzt seine Sidebar, die keine Berechtigung braucht.
- **Offscreen-Dokument** (`offscreen`, nur Chrome): liest den Text eines angehefteten PDFs im Hintergrund. Firefox macht das in der Hintergrundseite der Erweiterung.
- **Zugriff auf `api.anthropic.com`, `generativelanguage.googleapis.com` und `api.openai.com`**: sendet deine Anfragen an diese Anbieter, wenn du sie eingerichtet hast.
- **Optionaler Zugriff auf alle Websites oder auf eine Website:** Der Browser fragt dich vorher. Zugriff auf alle Websites wird angefragt, wenn du in der Seitenleiste oder den Einstellungen „Auf allen Websites erlauben“ wählst, Zugriff auf eine Website, wenn du eine Seite dieser Website aus der Seitenleiste anheftest. Er erlaubt der Erweiterung, die Adresse des aktuellen Tabs zu sehen und die Seiten zu lesen, die du anheftest, aktualisierst oder zu denen du fragst. Ohne ihn lassen sich Seiten weiterhin über das Rechtsklickmenü anheften. Du kannst ihn jederzeit in den Erweiterungseinstellungen des Browsers zurücknehmen.
- **Optionaler Zugriff auf eine eigene Anbieteradresse:** wird angefragt, wenn du einen OpenAI-kompatiblen Anbieter mit einer anderen als den oben genannten Adressen speicherst, damit Anfragen an ihn gesendet werden können.

In Firefox gibt die Erweiterung an, dass sie Website-Inhalte und Browsing-Aktivität verarbeitet. Gemeint sind der Seitentext und die Seitenadressen, die wie oben beschrieben an deinen eigenen Anbieter gehen.

## Änderungen und Kontakt

Änderungen an dieser Erklärung werden in dieser Datei vorgenommen. Ihr vollständiger Verlauf ist im Repository auf GitHub einsehbar.

Fragen oder Anliegen: Schreib an <feedback@findach.de> oder eröffne ein Issue unter <https://github.com/wolffischer82/Browser-Sidekick/issues>.
