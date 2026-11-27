# Browser Sidekick — orchestration rules

A browser extension for Chrome and Firefox (`src/`, `public/`, `dist/chrome-ext/`, `dist/firefox-ext/`).

## Conventions that apply regardless of agent

- Never commit to `main`. Work on the branch the spec prescribes (or the checked-out CI branch); if none is prescribed, use `feature/<spec-name>`.
- Conventional commits carrying the task id when working from a spec, e.g. `feat(popup): pin current tab [T07]`. One logical change per commit. Never leave the branch failing between commits.
- Commits use the GitHub noreply address `75468956+wolffischer82@users.noreply.github.com` (set repo-locally); pushes with any other address are rejected.
- GitHub hosts the repository and issue tracker only. All CI and builds run on the self-hosted runner on `lenovo-ai-server` (`runs-on: [self-hosted, Linux, X64]`); no GitHub-hosted runners, no setup/cache actions, no uploaded build artifacts.
- **Versioning (`x.y.z`):** Any PR that changes extension code or assets (`src/`, `public/`, `wxt.config.ts`) must bump the version once per branch/PR relative to `origin/main` using `npm version <minor|patch> --no-git-tag-version`, rebuild `dist/`, and update the `README.md` status line:
  - **Major (`x`):** owner-decided only — never bump `x` without explicit owner approval (and add the `major-release` label on the PR so CI allows it).
  - **Minor (`y`):** bump automatically on new features (`feat:`), resetting `z` to `0`.
  - **Patch (`z`):** bump automatically on bugfixes (`fix:`) and non-feature runtime changes.
  - Docs-, test-, tooling-, or CI-only PRs that do not touch extension code/assets keep the version unchanged.
  - Enforced in CI by `npm run check:version`.
- **Committed builds:** `dist/chrome-ext` and `dist/firefox-ext` are tracked in git so the owner can load them straight from a checkout. After the final source or version change, run `npm run build` and commit the changed `dist/` files on their own (`build: update committed builds [Txx]`); CI runs `npm run check:dist`. Never edit files in `dist/` by hand or commit anything else from `dist/`.
- **`README.md`:** Keep Status (version), Features, Limits, and Install sections current in the same task or PR when adding, removing, or visibly changing a user-facing feature, changing a limit, changing install or build steps, or bumping the version. Keep it brief: one line per visible feature; internal changes and small UI details get no mention.
- Request the narrowest manifest permissions that work; every new permission is an owner decision.
- Never log, print, or transmit page content, URLs, browsing history, or other user data. No `console.log` left in source; no `// TODO` without a task id; no lint-disable comment without a one-line reason; new user-facing strings go into every locale file (`public/_locales/*/messages.json`).
- **Reply length:**
  - Answers to the owner: under 150 words unless they ask for more. Lead with the answer.
  - Do not restate what the owner already knows, do not summarise what you just said, no closing offer.
  - Lists only for parallel items, at most one line each. No headers under 300 words.
  - These rules also apply to text posted to GitHub (comments, PR bodies, review summaries).

## Build runs (default Orchestrator session only)

Applies only to the default agent session (Orchestrator Neon: Gemini 4 Neon planning/review -> Gemini 4 Hydrogen execution). Custom agents (`gate-checker`, `advisor`, `spec-reader`) follow their own system prompt instead.

### The spec

The owner names the spec file to implement in their first message (e.g. `specs/<name>.md`). Treat that file as the single source of truth for the run. If no spec file is named, ask for one before doing anything else.

Every spec used here defines an ordered task list, a working method (task loop, definition of done, branching and commit rules), and per-task test requirements. Locate those sections once at the start, note their headings, and refer to them by heading in every subagent prompt.

### Your job

- Drive the task list in order, one task at a time. Do not start a task until its dependencies are marked done in the progress log the spec prescribes.
- Plan each task (Neon) before editing: read only the relevant task row, spec sections, and logs (use `spec-reader` via `invoke_subagent` for factual lookups from long specs or code to keep context lean). When working from a spec, append a short plan block (~10 lines: files to add/change, tests to write, open questions) to the progress log before writing code.
- Implement, write tests (tests first for pure logic; UI first then component tests for popup, options, and side-panel screens), bump `y`/`z` when changing runtime code/assets, rebuild `dist/`, update `README.md` and progress/decision logs, run the full verification gate (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:dist`, `npm run check:version`, `npm run lint:firefox`, and `npm run e2e` when relevant), and commit in small conventional commits (Hydrogen). In interactive multi-task runs, you may optionally spawn `invoke_subagent` with `TypeName="self"` for fresh per-task context while keeping the Neon -> Hydrogen split.
- Three attempts on the same failing step, then stop, re-read the docs, pick the simplest alternative, record it in the decision log, and continue (or escalate as a large decision if the root cause is still unclear).
- For UI tasks (popup, options page, side panel, content-script UI), load the built extension in a browser and inspect it visually before advancing; tests alone do not prove it renders.
- After the task's commits are green, inspect `git log` and `git diff --stat`, then invoke `gate-checker` (`invoke_subagent`, `TypeName="gate-checker"`) with the spec path, task id, and commit range, and wait for its report. Advance only on `PASS`, or `PASS-WITH-NOTES` you have judged acceptable. On `FAIL`, fix the findings and re-run `gate-checker`.
- Use `advisor` (`invoke_subagent`, `TypeName="advisor"`) only for hard calls: a large architectural decision with real trade-offs (data model, storage schema, message protocol between extension contexts, new dependency or manifest permission, extension points), a disagreement between builder and `gate-checker`, or a task that has failed the gate twice. Prompt: `Spec: <path>. Task <id>. Question: <question>. Evidence: <reports, commit range>.` Record its recommendation in the decision log. It never replaces asking the owner on user-visible matters.

### Decisions

- Internal implementation details the spec leaves open (file layout, helper names, test structure, package API differences): pick the simplest option that keeps the spec's stated extension points (if small and easily reversible) or consult `advisor` (if large), and record it in the decision log the spec prescribes.
- Anything user-visible — behaviour, wording, stored data, requested browser permissions, or bumping the major version (`x`) — that neither the spec nor the task gives, and every case the spec's working method lists as "stop and ask" (plus anything that spends money, needs credentials, or changes store-listing or account settings): ask the owner. Use `ask_question` when the owner is present in the conversation; otherwise record it in the questions log the spec prescribes and move to the next task that does not depend on the answer.

### Progress reporting to the owner

At the end of each task, one short paragraph: task id, verdict, deviations, open questions. At the end of the spec, point to whatever final report the spec prescribes.
