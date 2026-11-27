# Browser Sidekick — Agent Instructions

Manifest V3 Chrome & Firefox sidebar extension (`src/`, `public/`, `dist/chrome-ext/`, `dist/firefox-ext/`).

## Read first

1. [docs/product.md](docs/product.md) — current user-facing features, visual tokens, and limits.
2. [docs/boundaries.md](docs/boundaries.md) — hard invariants (**Hard Stop**: ask the owner before crossing any boundary).
3. [docs/decisions/](docs/decisions/) — short architecture decision records.
4. [docs/ops.md](docs/ops.md) — self-hosted CI, local verification, and store packaging.
5. [docs/publishing.md](docs/publishing.md) & `docs/store/` — store release checklists and copy (tested by Vitest).

## Working rules

- **Branching & worktrees:** Never commit or push directly to `main`. Work in a dedicated worktree under `~/Projects/.worktrees/<name>` and deliver via a Staging PR into `main`.
- **Git identity:** Commit with `75468956+wolffischer82@users.noreply.github.com` in conventional commit format (one logical change per commit).
- **Versioning (`x.y.z`):** Any PR touching `src/`, `public/`, or `wxt.config.ts` must bump the version once relative to `origin/main` via `npm version <minor|patch> --no-git-tag-version`, rebuild `dist/`, and update `README.md`'s `Status: ..., version x.y.z` line (`feat:` -> minor `y`; bugfix/runtime -> patch `z`; major `x` requires explicit owner approval and the `major-release` PR label). Docs/test/tooling/CI-only PRs keep the version unchanged.
- **Committed builds:** After the final source or version change, run `npm run build` and commit `dist/chrome-ext` and `dist/firefox-ext` (`npm run check:dist` must pass). Never edit `dist/` by hand.
- **Docs in sync:** Rewrite affected sections of `docs/product.md`, `docs/boundaries.md`, `docs/ops.md`, `README.md`, `PRIVACY*.md`, and `docs/store/` in place in the same PR; add a short ADR in `docs/decisions/` for durable architectural choices.
- **Hygiene & locales:** Never log or transmit page content, URLs, or user data; no `console.log` or `debugger` in `src/`; no lint-disable comments without a reason; add every new UI string to both `public/_locales/en/messages.json` and `public/_locales/de/messages.json`.
- **Visual verification:** For UI changes, inspect the rendered extension in Chrome/Playwright before handing over.

## Verification gate & subagents

Before pushing a Staging PR, run locally:

```sh
npm run lint && npm run typecheck && npm test && npm run build && npm run check:dist && npm run check:version && npm run lint:firefox && npm run e2e
```

Then run read-only subagent review over `origin/main..HEAD`:

- `gate-checker` (`.agents/agents/gate-checker.md`) — mandatory independent verification of gate, boundaries, hygiene, locales, README, and versioning.
- `security-reviewer` (`.agents/agents/security-reviewer.md`) — required when touching permissions, extractors, Markdown rendering, storage, provider calls, or `wxt.config.ts`.
- `advisor` (`.agents/agents/advisor.md`) — on-demand second opinion for hard architectural trade-offs or repeated gate failures.
