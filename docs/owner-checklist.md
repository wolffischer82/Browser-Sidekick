# Owner checklist (end of T11)

Checks that browser automation cannot perform. The owner runs them once T01–T11 are done.

Builds: Chrome "Load unpacked" on `dist/chrome-ext`; Firefox `about:debugging` → "Load Temporary Add-on" → `dist/firefox-ext/manifest.json`.

- [ ] T01: in both browsers, clicking the toolbar icon opens the sidebar and a second click closes it.
- [ ] T05 (Firefox): "Grant access" on a provider marked "No access" brings up the browser's permission prompt.
- [ ] T05 (Firefox and Chrome): saving an OpenAI-compatible provider with a custom URL (e.g. a local Ollama) asks for access to that site.
- [ ] Overall look-and-feel, in light and dark mode.
