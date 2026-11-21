# Summary levels

Spec for the owner request of 2026-11-15: Summarize offers several levels, from very short to long and detailed, and the last-used level is the default everywhere, including in new sessions. It builds on `specs/sidekick-mvp.md` (the "MVP spec") and `specs/redesign.md`; everything there still holds unless this spec changes it. Task ids continue the shared numbering (T26 onwards).

## 1. Goal

The Summarize button becomes a split button. One click summarizes at the remembered level; the arrow opens a menu of four levels, and picking one summarizes at that level and remembers it.

## 2. Owner decisions (2026-11-15)

- **O1 Levels.** Four levels, in this order: Very short, Short, Standard, Detailed. Standard is today's prompt, unchanged.
- **O2 Control.** A split button in the composer toolbar, in place of today's Summarize button. The main part summarizes at the remembered level in one click. The arrow opens a menu of the four levels; picking one summarizes immediately and becomes the remembered level.
- **O3 Memory.** One remembered level for the whole extension, in `storage.local`. Every session, old or new, uses it. Before anything was picked it is Standard.
- **O4 Transcript.** A summary's user message shows its level, e.g. "Zusammenfassen · Kurz". Summaries stored before this feature show "Zusammenfassen" as today.

Orchestrator decisions (user-visible details the owner did not set; reported to the owner with this spec):

- **O5** The main part keeps the label "Summarize" and shows the remembered level after it as a muted suffix ("Summarize · Short") when the panel is wide enough; in a narrow panel only the icon shows, as today. Its accessible name always includes the level.
- **O6** The arrow follows the main part's availability: when Summarize is unavailable both parts are `aria-disabled` and show the same tooltip as today. The menu marks the remembered level with a check.
- **O7** Retry of a summary resends the level stored on that message, not the current remembered level.

## 3. Out of scope

- Per-session levels, per-provider levels, or a setting for the level on the options page.
- Custom or user-edited prompts, length in words or tokens.
- Changes to the page set (MVP D4), the pin wait, title generation, or the thinking level.
- New manifest permissions, new dependencies.

## 4. Behaviour

### 4.1 Level

- `SummaryLevel` is `'veryShort' | 'short' | 'standard' | 'detailed'`.
- `Settings.summaryLevel` holds the remembered level (§5). Picking a level in the menu writes it before the request starts; the main part only reads it.
- All open side panels follow a change made in another one (the existing `storage.local` change handling).

### 4.2 Split button

- Main part: as today's button (icon, label, tooltip, `aria-disabled` rules), plus the level suffix (O5). Activating it summarizes at the remembered level.
- Arrow: a separate button with accessible name "Summary level" / "Zusammenfassungsstufe", `aria-haspopup="menu"` and `aria-expanded`. It opens a menu above the toolbar listing the four levels in O1 order, the remembered one checked (`menuitemradio`, `aria-checked`).
- Keyboard: Enter, Space and ArrowUp/ArrowDown on the arrow open the menu with focus on the checked item; ArrowUp/ArrowDown move, Home/End jump, Enter/Space pick, Escape and Tab close and return focus to the arrow. A click outside closes it. Follow the patterns of the existing header menus (model menu, thinking-level control) rather than inventing new ones.
- Picking an item closes the menu, stores the level, and summarizes at that level, exactly as the main part would.

### 4.3 Request

- Each level has its own fixed prompt string per locale (§4.4). The summarize flow takes the level and sends that prompt; everything else about the request (page set, pin wait, thinking level, sources, trimming) is unchanged.
- The user message is stored with `summaryLevel` (§5). Retry uses that stored level (O7).

### 4.4 Prompts

`summarizePrompt` stays the Standard prompt, unchanged, in both locales. Add `summarizePromptVeryShort`, `summarizePromptShort` and `summarizePromptDetailed`. English texts below; the German texts translate them faithfully in the style of the existing German `summarizePrompt` and end with "Antworte auf Deutsch." Each `description` says which level it belongs to and that it is not shown in the UI.

- **Very short**: "Summarize the pages provided in two or three sentences: what the content is about and its core message or takeaway. No headings and no lists. If there is more than one page, cover them together in those sentences. Cite pages with their number. Answer in English."
- **Short**: "Summarize the pages provided briefly. Start with one sentence on what the content is about, then list the five to seven most important points as bullets, one sentence each. Report what is actually said, not how the content is structured; for a video, summarize what is said in it. If there is more than one page, give three to five points for each page under its title, then one sentence on what the pages share or where they disagree. Cite pages with their number. Answer in English."
- **Detailed**: "Summarize the pages provided thoroughly. Structure your answer in exactly three parts, in this order, each under its own Markdown heading:\n\n## TL;DR\nAlways start with this part. Two or three sentences on what the content is about and its gist: the core message or takeaway.\n\n## Detailed summary\nGo through the content section by section, in the order it comes up, with a subheading for each section: its main points, arguments, explanations, examples, facts and figures, names and dates, and conclusions. Report what is actually said, not just how the content is structured; for a video, summarize what is said in it. Leave out nothing of substance. If there is more than one page, give the detailed summary of each page under its title, then an overall summary that covers the themes the pages share and the points on which they disagree.\n\n## Key takeaways\nA bulleted list of the most important conclusions and facts to remember.\n\nCite pages with their number. Answer in English."

### 4.5 Strings

| Key | en | de |
|---|---|---|
| `summaryLevelVeryShort` | Very short | Sehr kurz |
| `summaryLevelShort` | Short | Kurz |
| `summaryLevelStandard` | Standard | Standard |
| `summaryLevelDetailed` | Detailed | Ausführlich |
| `summaryLevelMenu` (arrow's accessible name) | Summary level | Zusammenfassungsstufe |
| `summarizeWithLevel` (transcript label, main part's accessible name; `$1` = level name) | Summarize · $1 | Zusammenfassen · $1 |

The visible suffix on the main part (O5) uses the level name only, styled muted.

## 5. Data

Optional fields only; a missing field means the stated default, so there is no IndexedDB version bump and no `storage.local` migration.

- `Settings.summaryLevel?: SummaryLevel`: missing is `'standard'`. Added to the settings store like the other fields; an unknown stored value reads as `'standard'`.
- `Message.summaryLevel?: SummaryLevel | null`: set on `kind: 'summarize'` user messages only. Missing or `null` shows the plain "Summarize" label and retries at Standard.

## 6. Task list

| ID | Task | Depends on |
|---|---|---|
| T26 | Summary level: data, prompts and request | T25 done |
| T27 | Split button, transcript label, README, final report | T26 |

### T26 Summary level: data, prompts and request
**Scope**: `SummaryLevel`, `Settings.summaryLevel` and `Message.summaryLevel` (§5), the three new prompt strings in both locales (§4.4), the summarize flow taking a level and storing it on the user message, and Retry using the stored level (§4.3). The current button keeps working and summarizes at the remembered level. No visible UI change.

**Acceptance**:
- Without a stored level, Summarize sends exactly today's request body (byte-identical prompt).
- Each level sends its own prompt in the UI language; the page set, pin wait and thinking level are unchanged.
- The summarize user message stores its level; Retry resends that level's prompt even after the remembered level has changed.
- Settings read missing or unknown `summaryLevel` as `'standard'`; writing it persists across reloads.
- Every new string exists in both locales with a `description`.

**Tests**:
- Settings tests: default, round trip, unknown value.
- Ask/summarize-flow tests with a mocked provider: each level's prompt reaches the request; the message stores the level; Retry with a changed remembered level uses the stored one; a stored message without the field retries at Standard.
- Locale test that both `messages.json` files have the same keys (extend the existing check if there is one).

### T27 Split button, transcript label, README, final report
**Scope**: the split button and menu (§4.2, O5, O6) replacing `SummarizeButton`, the strings of §4.5, the transcript label (O4), the README Features line for Summarize, and the final report `docs/summary-levels-report.md`. The mock LLM records the prompt it received so e2e can assert the level.

**Acceptance**:
- The main part summarizes at the remembered level; the menu shows four levels in O1 order with the remembered one checked; picking one summarizes at it and becomes the remembered level, also for a new session and after reopening the side panel.
- The suffix shows the remembered level in a wide panel and is hidden in a narrow one; the accessible name always includes it.
- Both parts are `aria-disabled` with today's tooltips when Summarize is unavailable; the menu cannot be opened then.
- Keyboard behaviour of §4.2 holds; focus returns to the arrow on close.
- Transcript shows "Summarize · <level>" for new summaries and "Summarize" for stored ones without a level, in both locales.
- README Features line updated in one line; the final report covers what shipped, deviations, manual check results and open questions.

**Tests**:
- Component tests for the split button: labels and suffix, menu open/close, checked item, picking, disabled states, keyboard navigation.
- Transcript component test for both labels.
- e2e against the mock LLM: pick Short from the menu, assert the mock received the Short prompt and the transcript label; create a new session, click the main part, assert Short again; reopen the side panel and assert the check mark. Screenshots of the button wide and narrow, the open menu, and the transcript label.

**UI check** in both browsers.

## 7. Working method

The MVP spec's "9. Working method" applies with the changes below; read its subsections "Task loop", "Definition of done", "Verification gate" and "Browser automation".

### Branching and commits
- Branch: `claude/wizardly-bell-ocx6mp` (the branch this session must use). Never commit to `main`.
- Conventional commits carrying the task id, e.g. `feat(summarize): summary levels in settings and request [T26]`, using the repo-local noreply address.
- Pushing the branch happens after each task's gate passes; a PR is opened only when the owner asks.

### Logs (in `docs/`)
- `progress.md`, `decisions.md` and `questions.md` continue, with T26–T27 added under a "Summary levels" heading. Owner decisions O1–O7 are copied to `decisions.md` in T26.
- `summary-levels-report.md`: the final report, written in T27.

### Task loop and definition of done
As in the MVP spec, including the rebuilt and committed `dist/` and the README rule.

### Verification gate
`npm run lint && npm run typecheck && npm run test && npm run build && npm run check:dist && npm run lint:firefox && npm run e2e`

### Browser automation
As in the MVP spec. T27 extends the Playwright suite and writes screenshots to `test-results/screens/<task>-<step>.png`. Nothing ever calls a real provider.

### Stop and ask
Stop and ask the owner about:
- Any new manifest permission or host permission.
- Any new dependency.
- Any stored data beyond §5.
- Any user-visible behaviour or wording not covered here.
- Anything that calls a real LLM provider or spends money.
- Open questions: none so far.
