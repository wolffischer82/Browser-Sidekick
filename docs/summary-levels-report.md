# Summary levels: final report

Spec: `specs/summary-levels.md` (owner request of 2026-11-15). Branch `claude/wizardly-bell-ocx6mp`, tasks T26 and T27, written 2026-11-15. Details per task are in `docs/progress.md` and `docs/decisions.md` under "Summary levels".

## What shipped

- **Four summary levels** (T26): Very short, Short, Standard and Detailed, each with its own fixed prompt in English and German. Standard is the prompt Summarize sent before, unchanged byte for byte. Only the prompt differs between levels; the pages, the pin wait, the thinking level, the sources and the trimming are the same.
- **One remembered level** (T26): `summaryLevel` in `storage.local`, Standard until something is picked, used by every session, old or new, and followed by every open side panel. "Delete all data" keeps it, like the other display preferences (owner decision, 2026-11-15).
- **Split button** (T27): the composer's Summarize button now has an arrow next to it. The main part summarizes at the remembered level in one click; the arrow opens a menu of the four levels above the toolbar with the remembered one checked, and picking one remembers it and summarizes at once. Keyboard: Enter, Space and the arrow keys open the menu on the checked item; arrow keys, Home and End move; Enter or Space pick; Escape and Tab close, and focus returns to the arrow. While Summarize is unavailable both parts are greyed out with today's tooltip, and the menu can't be opened.
- **Level on the button** (T27): the button's accessible name is always "Summarize · <level>". In a panel at least 480 px wide the level also shows after the label, muted; from 360 to 479 px the label alone shows; below 360 px only the icon.
- **Transcript label** (T26, T27): a summary's user message stores its level and shows "Summarize · <level>" ("Zusammenfassen · <Stufe>"); summaries stored before this feature show "Summarize". Retry of a summary resends the level stored on it, not the remembered one; one stored without a level retries at Standard.
- README Features line updated. No new manifest permission, no new dependency, no IndexedDB version bump, no `storage.local` migration.

Tests at the end of T27: 1399 unit and component tests in 58 files, 25 Playwright tests (Chromium, against the local mock LLM, which now records the prompt it received). Screenshots: `test-results/screens/T27-*.png` (not committed), light and dark: the button at 400, 480 and 320 px, the open menu, the transcript label, and the menu after the side panel was reopened.

## Deviations from the spec

- **"Wide enough" for the level suffix is 480 px** (decisions.md Summary levels T27-3). O5 leaves the width open. With the suffix shown at 400 px, the model menu shrank to its dot because the model name gives way first; from 480 px it keeps about the room it has at 400 px without the suffix. Between 360 and 479 px the button shows "Summarize" without the level, which the spec doesn't describe; the accessible name still includes it. For the owner: say if the suffix should show at a narrower width, at the cost of the model name.
- **The arrow narrows the model name.** The arrow takes about 28 px of the toolbar, so at 400 px the model menu shows fewer characters of the model name than before.
- **Check mark out of the item names** (T27-5). The check mark of a checked item was read as part of its name in Chromium ("✓Standard"); it is now marked decorative with CSS alternative text. This also applies to the model and thinking menus, which share the rule. Browsers without support for CSS alternative text keep the old behaviour.
- **Retry rebuilds a summary's prompt in the current UI language** from the stored level (T26-6) instead of resending the stored text; the two differ only if the UI language changed in between.

## Manual checks

Done, without a real provider:

- Chromium: the e2e flow passes, and the orchestrator reviewed the T27 screens of the built extension: the suffix at 480 px, the label alone at 400 px, the icon only at 320 px with nothing overflowing, the menu opening above the toolbar inside the panel with Standard and later Short checked, and "Summarize · Short" in the transcript, in light and dark.
- Firefox: `npm run lint:firefox` on `dist/firefox-ext` (0 errors, 18 warnings, as before). UI check: not done; no Firefox is available in the build container. It is the first item of the owner checklist below.
- No request has gone to a real provider.

For the owner, in Chrome and in Firefox, with your own key:

- [ ] Firefox: load `dist/firefox-ext`, open the side panel, and check the split button, its menu and the transcript label render as in Chrome.
- [ ] Summarize at each of the four levels on a long article and on a video: the answers differ in length as the level names say.
- [ ] Pick a level, close and reopen the side panel, restart the browser, start a new session: the level is still the one picked.
- [ ] Widen and narrow the side panel: the level shows after "Summarize" only when the panel is wide; nothing in the toolbar overflows.
- [ ] Keyboard only: reach the arrow with Tab, open the menu with Enter or the arrow keys, pick a level, close it with Escape.
- [ ] With the browser set to German: the menu, the button and the transcript label read in German.

## Open questions

None. `docs/questions.md` has no open entry for T26 or T27.
