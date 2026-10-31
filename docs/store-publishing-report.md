# Store publishing: final report

Spec: `specs/store-publishing.md`, deleted at the end of T25 (owner decision O7); its owner decisions O1 to O8 are kept in `docs/decisions.md`, Store publishing T25-1. Branch `claude/nifty-euler-7zmzi7`, tasks T22 to T25, written 2026-10-31. No PR is open; opening one waits for the owner's approval. Details per task are in `docs/progress.md` and `docs/decisions.md` under "Store publishing".

## What shipped

- **Licence and privacy policy** (T22). `LICENSE` (MIT, `wolffischer82`) and `"license": "MIT"` in `package.json`. `PRIVACY.md` and `PRIVACY.de.md` describe what is stored on the device, what goes to the user's provider and to which hosts, that the developer receives nothing, what each permission is for, and how to get in touch (`feedback@findach.de`, the issue tracker). Every statement was checked against the source; the files are listed per statement group in decisions.md T22-1.
- **Store packages** (T23). `npm run zip` writes `dist/browser-sidekick-<version>-chrome.zip`, `-firefox.zip` and `-sources.zip` (not tracked). `npm run verify:zips` checks that the packages equal the committed builds, that the sources zip holds only what the build needs and rebuilds the Firefox package byte for byte, and that `web-ext lint` finds no errors.
- **Store listing kit** (T24). `docs/store/listing.en.md` and `listing.de.md` (summaries, full descriptions, categories, links), `chrome-web-store.md` (single purpose, a justification per permission, remote code, data usage, certifications), `amo.md` (listing pointers, privacy policy, reviewer notes, source build instructions, data collection permissions). Four screenshots per language at 1280×800 and a 440×280 promo tile per language in `docs/store/assets/`, generated against the mock LLM by `npm run store:assets`. Unit tests check the character limits, the permission coverage and the image sizes.
- **Four data categories on both stores** (O8). The Firefox manifest declares `websiteContent`, `browsingActivity`, `authenticationInfo` and `personalCommunications`; the Chrome form ticks the matching four. This was the only change to the extension itself.
- **Publishing guide** (T25). `docs/publishing.md`: a step-by-step checklist per store that names, for every form field, the file and section to copy from, plus "Shipping an update". The README's Install section points maintainers to it; Development mentions `npm run store:assets`.

## Deviations

- **Chrome short description is the manifest description** (decisions.md T24-6). The Chrome Web Store takes the summary from the package, so the listing's short description is `extDescription` as it is (55 and 63 characters). A longer one would need a UI-string change, which the spec ruled out.
- **Contact email** (O1, changed during the run). `feedback@findach.de` replaced the issue tracker as the first contact; the tracker stays as the support link.
- **Sources zip is an allowlist** (T23-2). It contains `src/`, `public/`, `package.json`, `package-lock.json`, `wxt.config.ts`, `tsconfig.json`, `LICENSE` and `README.md`, so untracked local files can't slip in.
- **Screenshots** (T24-4). Each one shows a fictional page (800 px) next to the real side panel (480 px, so the German composer fits), composed to 1280×800. Pages are on made-up `.example` hosts and providers are fictional; nothing reaches the internet.
- **German UI in the asset script** (T24-5). Chromium on Linux needs the `LANGUAGE` environment variable; the shared e2e launcher sets it only for a non-English locale, so the e2e suite runs as before.
- **Chrome reviewer instructions** (T25-3). The guide reuses the AMO reviewer notes with the Chrome origin rather than keeping a second copy.

## What the owner still has to do

Follow `docs/publishing.md`. In short:

1. Approve and merge the branch to `main`, so the privacy policy URL resolves (the repository is public, O6).
2. Chrome Web Store developer account: done (created by the owner before T25). Make sure 2-step verification is on and the contact email `feedback@findach.de` is verified.
3. Create a Mozilla account on addons.mozilla.org and turn on two-step authentication.
4. From `main`: `npm ci`, `npm run zip`, `npm run verify:zips`.
5. Chrome: upload the Chrome zip, fill the listing, privacy and distribution tabs from `docs/store/`, choose the visibility, submit.
6. AMO: upload the Firefox zip and the sources zip, fill the listing from `docs/store/`, paste the privacy policy and reviewer notes, submit, then add screenshots and the German texts on the product page.
7. Answer reviewer questions from `docs/store/` and `PRIVACY.md`.
8. Once both listings are live, update the README status line and add the store links.

## Known limitations

- The guide's field names are the dashboards' as known when it was written; where they may have changed, it says "check the current form".
- The AMO build instructions name the environment used here (Ubuntu 24.04, Node.js 22.23.4, npm 10.9.9); update them if the zips are built elsewhere.
- The e2e test "pin from the needle" in `tests/e2e/pinning.spec.ts` fails about one run in four because the context menu is sometimes not registered yet when it is checked (T23). It is independent of this spec's changes.

## Open questions

None.
