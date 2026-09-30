# Decision log

Internal decisions and differences between the spec and current package or browser docs. Each entry: what, why, what it affects.

## T01

1. **Package versions pinned to what runs on Node 20.** The self-hosted runner (`lenovo-ai-server`) has Node 20.20.2. WXT 0.21 needs Node 22, Vitest 5 needs Node 22.12 and jsdom 30 needs Node 22, so the project uses WXT `~0.20.27`, Vitest `~4.1.11` and happy-dom as the test DOM. TypeScript is `~5.9.3` because typescript-eslint supports TypeScript below 6.1. `package.json` declares `engines.node >= 20.19.0`. Affects: all tasks; upgrading Node on the runner would allow newer versions.
2. **JSX via Vite's `oxc` option, no `@preact/preset-vite`.** WXT pulls in Vite 8, where the `esbuild` option is deprecated in favour of `oxc`. `oxc.jsx = { runtime: 'automatic', importSource: 'preact' }` in `wxt.config.ts`, and `jsxImportSource: preact` in `tsconfig.json`. Saves a dependency (and its Babel peer). Affects: no Preact devtools/HMR preset in `npm run dev`.
3. **Dev-only glue packages not named in spec section 6:** `typescript-eslint`, `@eslint/js`, `globals`, `eslint-config-prettier` (needed for the listed ESLint flat config on TypeScript with Prettier) and `happy-dom` (DOM for the listed `@testing-library/preact`). None ships in the extension. Listed for owner confirmation in `questions.md`.
4. **Permissions are added by the task that first needs them.** The T01 scope says "the section 6 permissions that are needed so far". The T01 manifest has only `sidePanel` (Chrome; WXT adds it for the `sidepanel` entrypoint) and `optional_host_permissions: ["<all_urls>"]` (kept now so Firefox support can be verified at load time). `storage` arrives with T02, the provider `host_permissions` with T04, `activeTab`/`scripting` with T06, `contextMenus` with T07. Each task updates the manifest snapshot test.
5. **Firefox MV3 uses `action`, not `browserAction`.** Spec 5.1 says `browserAction.onClicked`; in MV3 Firefox exposes `browser.action.onClicked` (Firefox 109+). The manifest declares `action: { default_title }` so both browsers have a toolbar icon. `sidebarAction.toggle()` is called synchronously in the click listener because Firefox only allows it from a user action. The `sidebarAction` type is not in WXT's Chrome-based typings, so `src/shared/sidebar-toggle.ts` declares the one method it uses.
6. **Firefox add-on id** `browser-sidekick@wolffischer82.github.io` in `browser_specific_settings.gecko.id` (Firefox requires an id for MV3; WXT warns without one). Can be changed freely until a store submission, which is out of scope.
7. **Firefox and Chrome support findings** (source: MDN browser-compat-data 8.1.3):
   - `optional_host_permissions`: Firefox 128 (MV3), Chrome 102. Supported at the spec's minimum Firefox 128 ESR, so no fallback to `optional_permissions` is needed.
   - `host_permissions` and `action`: Firefox 109. `sidebar_action`: Firefox 54. `sidebarAction.toggle()`: Firefox 73.
   - `permissions.request()` from a sidebar document: Firefox 101+ (earlier versions could not). Relevant for T05/T06.
   - `scripting.executeScript`: Firefox 102, Chrome 88.
   - `side_panel` and `sidePanel.setPanelBehavior`: Chrome 114, below the Chrome 116 minimum.
   - `browser_specific_settings.gecko.data_collection_permissions`: Firefox 140, above the Firefox 128 minimum. See `questions.md`.
   - Minimums set in the manifest: `minimum_chrome_version: "116"`, `gecko.strict_min_version: "128.0"`.
   - Firefox background is an event page (`background.scripts`); Chrome uses a service worker. WXT emits the right key per target.
8. **`web-ext lint` warning `UNSAFE_VAR_ASSIGNMENT`** comes from Preact's own `dangerouslySetInnerHTML` code path in the bundle, not from project code. Accepted; project code must not use `dangerouslySetInnerHTML` without the sanitiser (T10).
9. **i18n helper.** `src/shared/i18n.ts` exposes `t(key)` over `browser.i18n.getMessage` with a typed key union. WXT's `fakeBrowser` does not implement `i18n`, so tests stub it with the real `messages.json` of the chosen locale (`tests/helpers/i18n.ts`).
10. **Manifest snapshot test builds with WXT's JS API** into a temp directory, so it checks the manifest WXT really emits (including permissions WXT adds itself). About 1 s per target.
11. **Prettier ignores** `specs/`, `.claude/` and `CLAUDE.md` so formatting never rewrites owner-managed files.
12. **`e2e` script** is `playwright test --pass-with-no-tests` until T12 adds the smoke test. Playwright browsers are not installed yet.
13. **No icons yet.** The browsers show their default extension icon. See `questions.md`.
14. **`npm audit`**: 0 vulnerabilities in runtime dependencies; 10 in dev-only tooling (web-ext, WXT transitive). Not shipped in the extension.
