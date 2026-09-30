# Owner checklist (end of T11)

Checks that browser automation cannot perform. The owner runs them once T01–T11 are done.

Builds: Chrome "Load unpacked" on `dist/chrome-ext`; Firefox `about:debugging` → "Load Temporary Add-on" → `dist/firefox-ext/manifest.json`.

- [ ] T01: in both browsers, clicking the toolbar icon opens the sidebar and a second click closes it.
- [ ] T05 (Firefox): "Grant access" on a provider marked "No access" brings up the browser's permission prompt.
- [ ] T05 (Firefox and Chrome): saving an OpenAI-compatible provider with a custom URL (e.g. a local Ollama) asks for access to that site.
- [ ] T06 (Firefox and Chrome): on first open, "Allow on all sites" in the sidebar banner brings up the browser's permission prompt; after allowing, the Session tabs row shows the current tab's title.
- [ ] T06 (Firefox and Chrome): with two browser windows, clicking into the other window updates the current tab in the sidebar.
- [ ] T07 (Chrome and Firefox): right-click a web page, choose "Pin to Sidekick": the page is pinned into the active session, with the sidebar open (the row appears and turns Ready) and with it closed (the pin is there when the sidebar opens). Works without "Allow on all sites" too.
- [ ] T07 (Firefox): right-click a tab in the tab strip that isn't the selected tab, choose "Pin to Sidekick": that tab's page is pinned.
- [ ] T07 (Chrome and Firefox): without "Allow on all sites", open the sidebar with the toolbar icon on a web page. Note whether the Session tabs row shows the page (the click granted activeTab) or "Current tab not accessible". Chrome's side-panel behaviour can't be checked headless (decisions.md T07-16).
- [ ] T07 (Chrome and Firefox): if the row shows the page there, the pin needle asks for access to that one site; after allowing, navigate away and back, and Refresh on that pin works.
- [ ] Overall look-and-feel, in light and dark mode.
