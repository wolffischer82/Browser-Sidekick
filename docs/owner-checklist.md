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
- [ ] T07 / D17 (Chrome and Firefox): with the sidebar closed, right-click a web page and choose "Pin to Sidekick": the sidebar opens and shows the new pin. Do it again on the same page with the sidebar closed: it opens and shows "Already pinned". In Firefox also from a tab in the tab strip. With the sidebar already open, the click leaves it open.
- [ ] T08 (Chrome and Firefox): pin a real YouTube video with captions (the pin shows YouTube and Ready; after T10, asking about it answers from the transcript) and one without captions (Ready, title and description only). Also pin a video reached by clicking a suggested video on YouTube, and a Short.
- [ ] T09 (Chrome and Firefox): open a real PDF (for example a paper or a manual) in the browser's built-in viewer and pin it with the needle and with the context menu: the pin shows PDF and Ready. Also pin a PDF with the context menu without "Allow on all sites": note whether it's Ready or fails with "No access to this site" (decisions.md T09-6).
- [ ] T10 (Chrome and Firefox): with a real provider and your own key, pin a page, open another page and ask a question: the answer streams, cites `[1]`/`[2]`, and clicking a citation chip focuses that tab (a middle-click or Ctrl-click on it opens nothing else). Stop an answer midway. The session gets a short title after the first answer.
- [ ] T10 (Firefox): open a PDF in the built-in viewer without pinning it and ask about it: the answer uses the PDF (it is read in the sidebar; decisions.md T10-5). Also click a normal link in an answer: it opens in a new tab.
- [ ] T11 (Chrome and Firefox): with a real provider, pin two pages, open a third and press Summarize: you get a short summary per page and an overall part, with citation chips. With nothing readable, the button is disabled and its tooltip says why.
- [ ] Overall look-and-feel, in light and dark mode.
