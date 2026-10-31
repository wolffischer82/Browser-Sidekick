# Store publishing

Spec for publishing Browser Sidekick on the Chrome Web Store and on addons.mozilla.org (AMO). It builds on `specs/sidekick-mvp.md` (the "MVP spec"); everything there still holds unless this spec changes it. Task ids continue the shared numbering (T22 onwards).

The owner creates the store accounts, pays fees, uploads and submits. This spec only prepares everything they need, so that each store form can be filled by copying from the repository.

## 1. Goal

One command produces the files each store accepts. The repository holds a privacy policy, a licence, store listing texts in English and German, permission justifications, data disclosures, screenshots and a promo tile, and a step-by-step guide the owner follows to publish and later to ship updates.

## 2. Owner decisions (2026-10-31)

- **O1 Contact (changed 2026-10-31).** Public contact email is `feedback@findach.de`, used in the privacy policy, the listings, the store dashboards and the publishing guide. The GitHub issue tracker, `https://github.com/wolffischer82/Browser-Sidekick/issues`, stays as the support/homepage link. No other email address appears.
- **O2 Icon.** The current icon (`design/icon.svg`, exported to `public/icon/`) is used on both stores as it is.
- **O3 Version.** The first store release is 0.1.0, the current version.
- **O4 Languages.** Listings and the privacy policy exist in English and German.
- **O5 Licence.** MIT. Copyright holder: `wolffischer82`.
- **O6 Policy hosting.** The repository is public. The privacy policy is a Markdown file in it, linked by its GitHub URL on `main`. No GitHub Pages site.
- **O7 Spec removal (2026-10-31).** This spec file is deleted from the repository at the end of T25, after the final report is written; the logs keep the decisions.

## 3. Out of scope

- Any change to extension behaviour, permissions, stored data or UI strings.
- New icon artwork.
- Automated uploads (Chrome Web Store API, `web-ext sign`, store credentials in CI) and release workflows.
- Edge, Safari, Firefox for Android.
- Self-distributed (unlisted) signed Firefox builds.

## 4. Deliverables

### 4.1 Privacy policy
`PRIVACY.md` (English) and `PRIVACY.de.md` (German) at the repository root. It describes only what the code actually does; the implementer derives every statement from the source and cites nothing it has not checked. It covers at least:
- What is stored on the device (sessions, pins with page text and URL, chat history, settings, API keys), where (extension storage, IndexedDB), and that it is kept until the user deletes it or removes the extension.
- What leaves the device: page text, the question and history, sent only to the provider the user configured, only when they ask or summarise; plus model-list requests. Which hosts these are (the three built-in ones and any custom OpenAI-compatible origin the user enters). That the provider's own privacy policy then applies.
- That the developer receives nothing: no telemetry, analytics, ads, remote code, sale or transfer of data.
- What each permission is used for, in plain words.
- Contact email and issue tracker (O1), effective date, and that changes are tracked in the repository's history.

The stable URL for both stores is `https://github.com/wolffischer82/Browser-Sidekick/blob/main/PRIVACY.md`.

### 4.2 Licence
`LICENSE` with the MIT text (O5) and `"license": "MIT"` in `package.json`.

### 4.3 Store packages
`npm run zip` builds both targets and writes, outside version control:
- the Chrome zip (contents of `dist/chrome-ext`, `manifest.json` at the zip root);
- the Firefox zip (contents of `dist/firefox-ext`);
- the Firefox sources zip AMO requires for bundled code: everything needed to rebuild the Firefox package with `npm ci && npm run build:firefox`, and nothing else (no `node_modules`, `dist`, test output, `.claude`, `.git`, logs, local env files).

Zips are never committed and never uploaded by CI. The packaged builds must be byte-identical to the committed `dist/` folders.

### 4.4 Store listing kit (`docs/store/`)
- `listing.en.md`, `listing.de.md`: name; Chrome short description (at most 132 characters); AMO summary (at most 250 characters); full description (plain text, no Markdown the stores don't render); suggested category for each store; support URL (O1); homepage URL (the repository). Wording follows the README's Features and Limits and makes no claim the README doesn't.
- `chrome-web-store.md`: single-purpose statement; a justification for each permission and host permission in `dist/chrome-ext/manifest.json`, including optional `<all_urls>`; the remote-code answer (none); the data-usage disclosures (which categories are handled and the three certifications), consistent with §4.1; the privacy policy URL.
- `amo.md`: summary and categories (pointing to the listing files), licence (O5), privacy policy text to paste (AMO takes the text, not a URL), notes for reviewers: what the add-on does, that no account is needed for review except a provider key (suggest a local OpenAI-compatible server), and exact source build instructions (OS, Node and npm versions, commands, output path); and an explanation of the declared `data_collection_permissions`.
- `assets/`: screenshots at exactly 1280×800, English and German, at least three each (session with pinned pages and an answer with citations, summary, settings with providers); a small promo tile at 440×280. Generated by a script against the mock LLM (`tests/mock-llm/`), never a real provider, with no real URLs, keys or personal data visible. The script is committed so the images can be regenerated.

### 4.5 Publishing guide (`docs/publishing.md`)
An owner checklist, in order, for each store: account creation (Chrome: one-time fee, 2-step verification; AMO: account, 2FA), which zip goes into which upload field, which section of `docs/store/` fills which form field, visibility choice, submission, what review to expect and how to answer reviewer questions. A short "Shipping an update" section: bump `version` in `package.json`, rebuild and commit `dist/`, `npm run zip`, upload to both stores. Where a store's dashboard wording or rules may have changed, the guide says so instead of guessing.

## 5. Task list

| ID | Task | Depends on |
|---|---|---|
| T22 | Licence and privacy policy | — |
| T23 | Store packages (`npm run zip`) | — |
| T24 | Store listing kit and assets | T22 |
| T25 | Publishing guide, README, final report | T22, T23, T24 |

### T22 Licence and privacy policy
**Scope**: §4.1, §4.2. README: a "Privacy" line linking `PRIVACY.md` and a "License" line.

**Acceptance**:
- Every statement in the policy matches the code; the decision log lists, per statement group, the source files it was checked against.
- The English and German texts say the same thing.
- The only email address in either file is the contact address (O1); no other personal data.
- `LICENSE` and `package.json` carry MIT.

**Tests**: none beyond the verification gate (documentation only). The gate-checker cross-checks the policy against the code.

### T23 Store packages
**Scope**: §4.3: the `zip` script(s) in `package.json`, WXT zip configuration, `.gitignore` if needed.

**Acceptance**:
- `npm run zip` from a clean checkout produces the three zips and leaves `git status` clean.
- The unpacked Chrome and Firefox zips equal `dist/chrome-ext` and `dist/firefox-ext`.
- Unpacking the sources zip into an empty directory, then `npm ci && npm run build:firefox` there, reproduces `dist/firefox-ext` byte for byte.
- The sources zip contains none of the excluded paths in §4.3.
- `web-ext lint` on the Firefox zip reports no errors.

**Tests**: a script or test that performs the three comparisons above and fails on any difference; it is run by the implementer and the gate-checker, and documented in the decision log. It need not run in CI.

### T24 Store listing kit and assets
**Scope**: §4.4.

**Acceptance**:
- Character limits hold; the gate-checker counts them.
- Every permission in both manifests has a justification; disclosures agree with `PRIVACY.md` and with the Firefox `data_collection_permissions`.
- Screenshots are exactly 1280×800, the tile exactly 440×280, both languages, no real data visible; the generating script runs against the mock LLM only.

**Tests**: the asset script itself; a check of image dimensions.

**UI check**: the orchestrator looks at every asset.

### T25 Publishing guide, README, final report
**Scope**: §4.5. README: the Install section notes that store releases are being prepared and points to `docs/publishing.md` for maintainers (one line); the status line stays until the listings are live. Final report `docs/store-publishing-report.md`: what shipped, deviations, what the owner still has to do, open questions. Last commit of T25: delete `specs/store-publishing.md` (O7).

**Acceptance**:
- Each step in the guide names the exact file or section to use.
- Following the guide needs nothing that isn't in the repository, apart from the owner's accounts and payment.

**Tests**: none beyond the verification gate.

## 6. Working method

The MVP spec's "9. Working method" applies with the changes below; read its subsections "Task loop", "Definition of done", "Verification gate" and "Browser automation".

### Branching and commits
- Branch: `claude/nifty-euler-7zmzi7` from `main`. Never commit to `main`.
- Conventional commits carrying the task id, e.g. `docs: privacy policy [T22]`, using the repo-local noreply address.
- Opening a PR happens only after the owner approves.

### Logs (in `docs/`)
- `progress.md`, `decisions.md` and `questions.md` continue, with T22–T25 added under a "Store publishing" heading.
- `store-publishing-report.md`: the final report, written in T25.

### Task loop and definition of done
As in the MVP spec, including the rebuilt and committed `dist/` (unchanged by this spec unless the `license` field affects the build) and the README rule.

### Verification gate
`npm run lint && npm run typecheck && npm run test && npm run build && npm run check:dist && npm run lint:firefox && npm run e2e`

### Browser automation
As in the MVP spec. Nothing ever calls a real provider.

### Stop and ask
Stop and ask the owner about:
- Any change to extension behaviour, permissions, stored data or UI strings.
- Any new dependency.
- A policy or disclosure statement the code doesn't clearly support either way.
- Any store rule that seems to require a change to the extension (e.g. a permission a reviewer would reject).
- Anything that calls a real LLM provider, contacts a store, or spends money.
