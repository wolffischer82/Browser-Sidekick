# Side panel redesign

Spec for a visual redesign of the side panel. It builds on `specs/sidekick-mvp.md` (the "MVP spec") and `specs/thinking-levels.md`; everything there still holds unless this spec changes it. Task ids continue the shared numbering (T17 onwards).

The visual reference is the design canvas in `design/redesign/`. Each `.dc.html` file is a self-contained mockup: read its markup and inline styles; the `<script>` block only switches light and dark tokens (§4). Sample content in the mockups (titles, hosts, letter tiles standing in for favicons) is illustration. Where this spec and a mockup differ, this spec wins.

| File | Shows |
|---|---|
| `Main.dc.html` | Chat view with pins, current tab, answer, composer (light; `MainDark.dc.html` renders it dark) |
| `Sessions.dc.html` | Sessions drawer with groups, hover delete and the delete confirm |
| `Settings.dc.html` | Settings: providers, page access, delete all data |
| `Welcome.dc.html` | First run: access banner, current tab not accessible, empty state, no provider |
| `Tokens.dc.html` | Style sheet: type, colour, radii, controls |

## 1. Goal

The side panel looks cleaner and is easier to scan: a warm neutral ground with white cards, one accent colour, bundled Geist fonts, numbered pins that match the citations, and the model controls next to where the question is typed.

## 2. Owner decisions (2026-10-03)

- **O1 Design.** The canvas is approved as drawn, including the layout changes in §5: Model and Thinking move into the composer, a Send button is added, the header shows a subtitle, pins are numbered with their actions on hover and focus, and the drawer groups sessions by date.
- **O2 Fonts.** Geist and Geist Mono are bundled with the extension as woff2 files with their OFL licence. Nothing is loaded from the network at runtime.
- **O3 Process.** The owner asked for this spec to be drafted and driven without a separate review.

## 3. Out of scope

- Any change to behaviour, stored data, permissions, the LLM layer or extraction, beyond what §5 lists.
- A theme or accent setting. The accent is fixed; light and dark follow the browser.
- New npm dependencies (fonts are vendored files, §4.2).
- Pages other than the side panel (the offscreen document has no UI).

## 4. Visual system

### 4.1 Colour tokens

Defined once as CSS custom properties in `style.css`, light by default and dark under `prefers-color-scheme: dark`. Hex values outside the token blocks are not allowed.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #F6F6F3 | #111214 | Panel ground |
| `--surface` | #FFFFFF | #1A1B1E | Header, cards, composer, drawer |
| `--sunken` | #EFEFEB | #24252A | User bubble, inline code, chips, hovered rows |
| `--line` | #E4E4DF | #2D2F35 | Borders and dividers |
| `--ink` | #17181B | #ECEDEF | Text |
| `--muted` | #5D616A | #A2A6AE | Secondary text, icons |
| `--accent` | #2D5BE3 | #8EA8EE | Links, primary buttons, citations, current tab |
| `--accent-soft` | #EEF2FC | #2D323F | Citation and badge fill, selected rows |
| `--on-accent` | #FFFFFF | #0E1013 | Text on `--accent` |
| `--ok` | #1E7A46 | #6FCF97 | Ready, success |
| `--warning` | #7A5300 | #F1C96B | Warnings, "No access", "Truncated" |
| `--warning-soft` | #FBF0D9 | #3A2F14 | Warning fills |
| `--danger` | #B42318 | #F97066 | Errors, delete |
| `--shadow` | `0 1px 2px rgb(20 20 25 / 5%), 0 6px 20px rgb(20 20 25 / 6%)` | `0 1px 2px rgb(0 0 0 / 40%), 0 6px 20px rgb(0 0 0 / 30%)` | Composer, banners, menus |

Tinted borders and fills seen in the mockups (danger-tinted confirm card, accent-tinted dashed border) use `color-mix()` over these tokens. Text on its background meets 4.5:1 in both themes.

### 4.2 Type

- Geist (UI and answers) and Geist Mono (code, citation numbers, model names, counts, version). Vendor the variable woff2 files, latin and latin-ext subsets, from the `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages (fetched once with `npm pack`, not added to `package.json`), with the licence as `OFL.txt` next to them. Record the package versions in `decisions.md`. `font-display: swap`; fallback stacks `ui-sans-serif, system-ui, sans-serif` and `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Sizes: base 14 px, line-height 1.45; answers 14 px at 1.6; session title 15 px/600; pin titles and buttons 13 px/500; meta lines 11.5–12.5 px; section labels 12 px/600, uppercase, letter-spacing 0.04em, `--muted`.

### 4.3 Shape, spacing, icons

- Radii: 6 px code and citations; 8–10 px buttons, chips, menu items; 12 px cards and lists; 16 px composer and user bubble (bubble 16 16 4 16).
- Spacing on a 4 px grid (4, 8, 12, 16, 24).
- Icons: inline stroke SVG, 1.8 px stroke, round caps and joins, 15–18 px. The header's Settings icon becomes the sliders icon from the mockups; the Sessions icon has the shorter third line.
- Icon buttons: 36 px in the header, 28–30 px inside rows. Every icon-only button keeps its accessible name.
- Focus: every interactive element shows a 2 px `--accent` outline with 2 px offset on `:focus-visible`.
- Motion: the drawer slide and chevron rotation stay at most 150 ms and are off under `prefers-reduced-motion: reduce`.

### 4.4 Controls

- Primary button: `--accent` fill, `--on-accent` text, 600, height 32–34 px. Secondary: `--surface` fill, `--line` border. Danger: transparent with a danger-tinted border and `--danger` text; the confirming Delete is a filled `--danger` button with white text.
- Text inputs and selects: 36 px high, `--surface`, `--line` border, radius 9 px, accent focus ring. Labels 13 px/500 above the field, hints 12 px `--muted` below.
- Badges: pill, 11 px/600; accent (`--accent-soft`/`--accent`) or warning (`--warning-soft`/`--warning`).
- Notices: warning notices use `--warning-soft` with `--warning` text; errors a danger-tinted border and fill with `--danger` text.

## 5. Behaviour and layout changes

Everything not listed here works as today, with the new look.

### 5.1 Header (`Main.dc.html`)

- Order: Sessions, title block, New session, Settings. Header background `--surface` with a bottom `--line`.
- The title block shows the title (15 px/600, one line, ellipsis) and below it a subtitle: the pin count and the last activity, e.g. "4 pins · active 2 minutes ago", or "No pins yet" without pins. The relative time comes from the existing `relative-time.ts` and refreshes at least once a minute while shown. The subtitle is not part of the rename button's accessible name. Rename works as today.
- The Model and Thinking menus leave the header (§5.4); the header's narrow-width layout rules go with them.

### 5.2 Session tabs (`Main.dc.html`, `Welcome.dc.html`)

- Toggle: chevron, the label "Session tabs" as a section label (§4.2), and the count in a Geist Mono pill. The count is the same number as today. The toggle's accessible name includes the count.
- Pins sit in one 12 px card, rows separated by `--line`. Each row: a 24 px tile (radius 7, `--sunken`) holding the 16 px favicon, or a fallback icon by type (globe for Page, play for YouTube, file for PDF); the title (13 px/500, ellipsis); a meta line with the citation number in Geist Mono `--accent`, the host and the type ("Page", "YouTube", "PDF") as plain text separated by "·", plus "Current tab" in `--accent`/600 when the pin is the current tab, and "Truncated" in `--warning` when it applies.
- Citation number: the pin's position in pin order, starting at 1, exactly as `assembleContext` numbers it (non-ready pins keep their number). Use one shared helper for the UI and the context so they cannot drift.
- Right side of a pin row: the status: ready is a 6 px `--ok` dot with visually hidden "Ready"; extracting is a small spinner and "Extracting…" in `--accent`; failed is "Failed" in `--danger` with the reason under the row as today. On row hover and on `:focus-within`, the actions (Open, Refresh when available, Unpin) replace the status; the hovered row gets `--sunken`. Unpin is a filled needle in `--accent` on `--accent-soft`.
- Current-tab row (unpinned, readable): its own card below the pins with a dashed accent-tinted border and `--accent-soft` fill. Meta line: the number it will be cited with (pin count + 1), "Current tab" in `--accent`/600, and the host. Actions: the eye toggle and a "Pin" text button with the outline needle (accessible name stays "Pin to session"). When excluded, no number is shown and the existing faded state and "Not included in questions" stay.
- Not-accessible and restricted current-tab rows: dashed `--line` border on `--surface`, muted text, globe tile (`Welcome.dc.html`). Wording and links as today.
- The "Already pinned" notice, the empty text and the 45vh scroll cap stay, restyled.

### 5.3 Transcript (`Main.dc.html`, `Welcome.dc.html`)

- Padding 14 px 18 px. User message: right-aligned, max 85 %, `--sunken`, radius 16 16 4 16.
- Assistant message: no bubble, 14 px at 1.6. Inline code in Geist Mono 12.5 px on `--sunken`, radius 5. Code blocks and blockquotes restyled with the tokens.
- Citations: 18 px high, min 18 px wide, radius 6, `--accent-soft` fill, `--accent` text, Geist Mono 11 px, no border, showing the number only (no brackets). The accessible name "Source N: title" stays.
- Meta footer: Geist Mono 11 px `--muted`, "Provider · model" as today.
- Reasoning row: chevron and label in 12.5 px `--muted`; the open body keeps its indented left rule.
- Waiting texts, Stop, "Stopped", inline notices and the error box with Retry keep their wording and behaviour, restyled with §4.4.
- Empty state: the decorative stacked-pages illustration from `Welcome.dc.html` (CSS or inline SVG, `aria-hidden`) above the existing text, centred.

### 5.4 Composer (`Main.dc.html`, `Welcome.dc.html`)

- One `--surface` card (radius 16, `--line` border, `--shadow`) at the bottom, holding the textarea (same placeholder, Enter and Shift+Enter as today) and a toolbar row: Model menu, Thinking menu, flexible space, Summarize, Send.
- Model menu button: `--sunken` pill, 30 px, a 7 px `--accent` dot when a model is set, the model name (ellipsis), chevron. "No model" without a model, muted and without the dot. Its accessible name and tooltip stay.
- Thinking menu button: transparent, lightbulb icon, the level name only (e.g. "Medium"), chevron. Its accessible name and tooltip stay "Thinking level: Medium". Hidden in the same cases as today.
- Both lists open upward from the composer, aligned to their button's left edge, and fit within the panel (max height the space above, scrolling inside). Keyboard behaviour stays as today.
- Summarize: secondary button with the lines icon. It replaces the action bar, which is removed. The unavailable state and its explanatory tooltip stay; the tooltip opens above the button.
- Send: 32 px icon button, arrow-up icon, `--accent` fill, accessible name "Send". It does exactly what Enter does and is disabled whenever Enter would not send (shown with `--sunken` fill and `--muted` icon).
- Under the card: the hint "Enter to send · Shift+Enter for a new line", 11 px `--muted`, centred. When asking is unavailable, the existing hint with its link ("Add a provider in settings…", "No access to…") replaces it, and the card is shown at 70 % opacity.
- Narrow panels: at widths below 360 px the Summarize button shows its icon only (accessible name kept) and the model name truncates first. Nothing in the toolbar wraps or overflows at 320 px.

### 5.5 Banners (`Welcome.dc.html`)

- The access banner becomes a `--surface` card with `--shadow`, a 32 px `--accent-soft` tile with the shield icon, the text, and the primary "Allow on all sites" and plain "Dismiss" buttons. The provider notice and error banners use §4.4 notices.

### 5.6 Sessions drawer (`Sessions.dc.html`)

- Width min(88 %, 320 px), `--surface`, right border and shadow, over a dimmed backdrop. Header "Sessions" (17 px/600) with Close.
- A full-width "New session" button (accent-soft fill, accent text, plus icon) under the header, doing what the header's New session does and closing the drawer.
- Sessions, still sorted by last activity, are grouped under section labels: "Today" (last activity today, local time), "This week" (earlier in the current calendar week, weeks start on Monday), "Earlier". Empty groups are not shown.
- Row: title (13.5 px; 600 for the active session, 500 otherwise) and the existing "relative time · N pins" line. The active row has `--accent-soft` fill and a 7 px `--accent` dot. The delete button shows on row hover and `:focus-within`, for every row.
- The delete confirm becomes a danger-tinted card in place of the row, wording and behaviour unchanged.

### 5.7 Settings (`Settings.dc.html`)

- Header: Back and "Settings" (16 px/600). Body padding 16 px 12 px, sections 20 px apart, each a section label (§4.2) above a 12 px card.
- Providers: label row with "Add provider" as an accent text button with plus icon. Provider rows inside one card: a 32 px `--sunken` tile with the first letter of the provider's name (uppercase), the name (600) with its badges, the type and default model line (model in Geist Mono), the no-access notice as a warning notice with its link, the "Make default" and "Edit" links, and the trash button. The delete confirm stays, restyled.
- The provider form, page access and delete-all-data sections keep their fields, wording and behaviour, restyled with §4.4. Page access shows its state as a dot (`--ok` allowed, `--warning` not allowed) with the existing text.
- Footer: "Browser Sidekick" and the version from `browser.runtime.getManifest().version`, Geist Mono 11 px `--muted`, centred.

### 5.8 Strings

Both locales, following the MVP spec's §8 style rules.

| Key purpose | en | de |
|---|---|---|
| Session tabs label (count shown separately) | Session tabs | Sitzungs-Tabs |
| Header subtitle, last activity | active $TIME$ | aktiv $TIME$ |
| Header subtitle, no pins | No pins yet | Noch keine Pins |
| Send button | Send | Senden |
| Composer keyboard hint | Enter to send · Shift+Enter for a new line | Enter zum Senden · Umschalt+Enter für eine neue Zeile |
| Current-tab row, pin button text | Pin | Anheften |
| Drawer group | Today | Heute |
| Drawer group | This week | Diese Woche |
| Drawer group | Earlier | Früher |

The subtitle joins the existing pin-count string and the activity string with " · ". Keys that are no longer used (the old "Session tabs ($COUNT$)" and the visible "Thinking: $LEVEL$" label) are removed from both locales.

## 6. Task list

| ID | Task | Depends on |
|---|---|---|
| T17 | Visual foundation | thinking levels done |
| T18 | Header, composer and transcript | T17 |
| T19 | Session tabs and banners | T17 |
| T20 | Drawer, settings, README, final report | T18, T19 |

### T17 Visual foundation
**Scope**: the tokens (§4.1), the vendored fonts and type scale (§4.2), radii, spacing, icons and focus rings (§4.3), and the shared control styles (§4.4), applied across the existing views without layout changes. Old token names are replaced, not aliased.

**Acceptance**:
- Every colour in `style.css` comes from §4.1; no hex or rgb outside the token blocks.
- The panel renders in Geist and Geist Mono in Chrome and Firefox with no network request for fonts; the licence file ships in both builds.
- Every interactive element shows the focus ring on keyboard focus.
- Contrast of each text token on its background meets 4.5:1 in both themes.
- No behaviour change: the existing unit and e2e suites pass unchanged apart from selectors.

**Tests**:
- A unit test that parses `style.css` and fails on colour literals outside the token blocks, and checks every §4.1 token exists in both blocks.
- A contrast test over the §4.1 text/background pairs in both themes.
- e2e: the font files load from the extension origin (no external requests) and `document.fonts` reports Geist loaded. Screenshots of the main view, light and dark, at 400 px.

**UI check** in both browsers.

### T18 Header, composer and transcript
**Scope**: §5.1, §5.3, §5.4 and their strings (§5.8). The action bar component is removed.

**Acceptance**:
- Every bullet of §5.1, §5.3 and §5.4 holds.
- Model and Thinking menus work from the composer with mouse and keyboard, open upward and stay inside the panel at 320 px and 600 px wide.
- Send and Enter behave identically in every state (empty input, streaming, no provider, no access).
- Summarize keeps its unavailable tooltip.
- Citations show numbers only and keep their accessible names and click behaviour.

**Tests**:
- Component tests: header subtitle (pins, no pins, refresh), Send enabled/disabled states, keyboard hint versus unavailable hints, Thinking button text and accessible name, citation text and name, narrow-width Summarize.
- Update the existing header, model menu, thinking menu, action bar and composer tests to the new structure.
- e2e against the mock LLM: ask with Send, open both menus from the composer and change model and level, Summarize, stop. Screenshots at 400 px and 320 px, light and dark: idle, menu open, streaming, answer with citations, no provider.

**UI check** in both browsers.

### T19 Session tabs and banners
**Scope**: §5.2, §5.5 and their strings, including the shared citation-number helper.

**Acceptance**:
- Every bullet of §5.2 and §5.5 holds.
- The number on each pin row and on the current-tab row equals the citation number the model receives, including with a non-ready pin and with the current tab pinned or excluded.
- Row actions are reachable and usable by keyboard alone.

**Tests**:
- Unit test of the numbering helper and that `assembleContext` uses it.
- Component tests: pin row states (ready, extracting, failed, truncated, current), actions on hover and focus, fallback icons, current-tab row included and excluded, not-accessible and restricted rows, toggle name with count.
- Update the existing session tabs and access banner tests.
- e2e: pin pages of each type, check numbers against a cited answer from the mock LLM, exclude the current tab, open a pin via keyboard. Screenshots light and dark: list collapsed, open with all states, row hovered, first run with the banner.

**UI check** in both browsers.

### T20 Drawer, settings, README, final report
**Scope**: §5.6, §5.7 and their strings, the README (any line that describes where controls are or how the panel looks), and the final report `docs/redesign-report.md`.

**Acceptance**:
- Every bullet of §5.6 and §5.7 holds.
- Grouping is correct around midnight and on Mondays.
- The README matches the shipped UI.
- The final report covers what shipped, deviations from the mockups and why, known limitations, the manual check results and open questions, and lists the screenshots that show each mockup's counterpart.

**Tests**:
- Unit test of the date grouping (today, this week with Monday start, earlier, empty groups, local midnight).
- Component tests: drawer groups, active row, delete on hover and focus, New session in the drawer; provider row tile and badges, page access dot, version footer.
- Update the existing drawer and settings tests.
- e2e: create sessions with set activity times, open the drawer, delete one, start one from the drawer; open settings, add and edit a provider against the mock LLM. Screenshots light and dark of the drawer, the delete confirm, settings, and the provider form.

**UI check** in both browsers.

## 7. Working method

The MVP spec's "9. Working method" applies with the changes below; read its subsections "Task loop", "Definition of done", "Verification gate" and "Browser automation (owner decision 2026-09-30)".

### Branching and commits
- Branch: `feature/redesign` from `main`. Never commit to `main`.
- Conventional commits carrying the task id, e.g. `style(sidepanel): colour tokens and fonts [T17]`, using the repo-local noreply address.
- Pushing the branch and opening the PR happen only after the owner approves.

### Logs (in `docs/`)
- `progress.md`, `decisions.md` and `questions.md` continue, with T17–T20 added under a "Redesign" heading.
- `redesign-report.md`: the final report, written in T20.

### Task loop and definition of done
As in the MVP spec, including the rebuilt and committed `dist/` and the README rule.

### Verification gate
`npm run lint && npm run typecheck && npm run test && npm run build && npm run check:dist && npm run lint:firefox && npm run e2e`

### Browser automation
As in the MVP spec. Every task here is a UI task: it extends the Playwright suite and writes screenshots to `test-results/screens/<task>-<step>.png` (the helper adds the dark variant). Compare them with the matching mockup before reporting DONE. Nothing ever calls a real provider.

### Stop and ask
Stop and ask the owner about:
- Any new manifest permission or host permission.
- Any new npm dependency.
- Any change to stored data.
- Any user-visible behaviour or wording not covered here.
- A mockup detail that can't be built as drawn without breaking an MVP or thinking-levels acceptance criterion.
