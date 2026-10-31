# Publishing Browser Sidekick

The steps to publish Browser Sidekick on the Chrome Web Store and on addons.mozilla.org (AMO), and to ship updates later. Everything the forms ask for is in this repository; you only need your own store accounts and, for Chrome, the registration fee.

Store dashboards change their wording and rules from time to time. Field names below are the ones known when this guide was written. Where a step says "check the current form", match the field by meaning, and if a form asks for something this guide doesn't cover, don't guess: note it and decide before submitting.

Contact address on every form: `feedback@findach.de`. Support and homepage links: the GitHub repository and its issue tracker (both in `docs/store/listing.en.md`, sections "Support" and "Homepage").

## Before you start (both stores)

1. **Merge to `main` and keep the repository public.** Both stores link the privacy policy at `https://github.com/wolffischer82/Browser-Sidekick/blob/main/PRIVACY.md`. Open that address in a private browser window and make sure it shows the policy before you submit anything.
2. **Install Node.js 20.19 or later** (the AMO build notes in `docs/store/amo.md` were written with Node.js 22.23.4 and npm 10.9.9).
3. **Build the store zips** from a clean checkout of `main`:

   ```sh
   npm ci
   npm run zip
   npm run verify:zips
   ```

   `npm run zip` writes three files to `dist/` (they are not tracked by git):
   - `dist/browser-sidekick-<version>-chrome.zip`: the Chrome package.
   - `dist/browser-sidekick-<version>-firefox.zip`: the Firefox package.
   - `dist/browser-sidekick-<version>-sources.zip`: the source code AMO asks for.

   `npm run verify:zips` must print `ok` for every check. It checks that the packages equal the committed builds in `dist/chrome-ext` and `dist/firefox-ext`, that the sources zip rebuilds the Firefox package exactly and contains nothing private, and that `web-ext lint` reports no errors. Don't upload zips if it prints `FAIL`.

4. **Have these files at hand:**
   - Listing texts: `docs/store/listing.en.md` and `docs/store/listing.de.md`.
   - Chrome privacy answers: `docs/store/chrome-web-store.md`.
   - AMO answers: `docs/store/amo.md`.
   - Images: `docs/store/assets/` (screenshots `screenshot-*.en.png` and `screenshot-*.de.png` at 1280×800, promo tiles `promo-small.en.png` and `promo-small.de.png` at 440×280).
   - Store icon: `public/icon/128.png`.
   - Privacy policy: `PRIVACY.md` and `PRIVACY.de.md`. Licence: `LICENSE` (MIT).

In the text files, copy the content of each fenced `text` block exactly as it is, without the fence lines.

## Chrome Web Store

### 1. Developer account

1. Sign in to the Chrome Web Store developer dashboard with the Google account that will own the listing.
2. Turn on 2-step verification for that Google account. The dashboard requires it before you can publish.
3. Accept the developer agreement and pay the one-time registration fee (check the current form for the amount).
4. In the account settings, set the publisher name and the contact email `feedback@findach.de`, and verify the email when the confirmation message arrives. If the dashboard asks whether you are a trader under EU law, answer it yourself; check the current form for what each answer makes public.

### 2. Upload the package

1. Choose "New item" (check the current form for the button name).
2. Upload `dist/browser-sidekick-<version>-chrome.zip`. Upload this zip, not a folder, and not the Firefox or sources zip.
3. The dashboard reads the name, the version and the short summary from the package. The summary is the manifest's `description` (`extDescription` in `public/_locales/en/messages.json`; the German one in `public/_locales/de/messages.json`); it is the "Chrome short description" in `docs/store/listing.en.md` and `listing.de.md`. At the time of writing, there is no form field for it. Changing it needs a new version of the extension (see "Shipping an update").

### 3. Store listing tab

From `docs/store/listing.en.md`:

| Form field                      | Use                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Description                     | section "Full description"                                                                      |
| Category                        | section "Category" (Chrome Web Store line)                                                      |
| Language                        | English                                                                                         |
| Store icon (128×128)            | `public/icon/128.png`                                                                           |
| Screenshots                     | `docs/store/assets/screenshot-1-answer.en.png` to `screenshot-4-settings.en.png`, in that order |
| Small promo tile (440×280)      | `docs/store/assets/promo-small.en.png`                                                          |
| Marquee promo tile, promo video | leave empty (optional; none are provided)                                                       |
| Homepage URL / official URL     | section "Homepage"                                                                              |
| Support URL                     | section "Support"                                                                               |

German listing: the package contains a German locale, so the dashboard should offer the listing in German too (check the current form for the language selector). For German, use section "Full description" of `docs/store/listing.de.md` and the `screenshot-*.de.png` files and `promo-small.de.png`.

### 4. Privacy practices tab

Everything comes from `docs/store/chrome-web-store.md`:

| Form field                                                                                      | Section                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Single purpose description                                                                      | "Single purpose"                                                         |
| Justification for `storage`, `activeTab`, `scripting`, `contextMenus`, `offscreen`, `sidePanel` | the section with the permission's name under "Permission justifications" |
| Host permission justification                                                                   | "Host permissions"                                                       |
| Are you using remote code?                                                                      | "Remote code": answer No and, if there is a text field, paste its block  |
| Data usage: categories                                                                          | "Data usage": tick the four categories listed there and no others        |
| Data usage: certifications                                                                      | "Certifications": tick all three                                         |
| Privacy policy URL                                                                              | "Privacy policy URL"                                                     |

If the dashboard asks for a justification for a permission that isn't listed in `chrome-web-store.md`, stop: the package has changed or the form has, and the justifications have to be checked against `dist/chrome-ext/manifest.json` first.

### 5. Distribution tab

1. Payment: free (the extension has no paid features).
2. Visibility: choose **Public** to list it in the store. **Unlisted** is an alternative if you first want to try the store version yourself through its direct link; you can switch to Public later.
3. Regions: all regions, unless you decide otherwise.

### 6. Test instructions for the reviewer

If the dashboard has a field for test instructions (check the current form), paste the "Notes to reviewer" block from `docs/store/amo.md` with two changes: replace `moz-extension://*` with `chrome-extension://*`, and "sidebar" with "side panel".

### 7. Submit and review

1. Choose "Submit for review". If the form asks whether to publish automatically once the review passes, choose what you prefer; with deferred publishing you press "Publish" yourself afterwards.
2. Review time varies from a few days to a few weeks. Extensions with host permissions may get a more thorough review; the dashboard shows a notice if that applies. The status is shown on the item's page in the dashboard, and messages go to the account's email.
3. Reviewer questions and rejections arrive by email and name the policy concerned. Answer from `docs/store/chrome-web-store.md` (permissions, data usage) and `PRIVACY.md`. If a reviewer asks for a change to the extension itself, such as removing a permission, don't change it in the form: that is a code change and needs a decision and a new version first. The rejection email links to the appeal process if you disagree.

## addons.mozilla.org (AMO)

### 1. Developer account

1. Create a Mozilla account on addons.mozilla.org (or sign in with an existing one). Use an address you read; AMO sends review messages to it.
2. Turn on two-step authentication for the Mozilla account. AMO requires it before you can submit.
3. In your AMO profile, set the display name you want shown as the author. There is no fee.

### 2. Upload the package

1. In the Developer Hub, choose "Submit a New Add-on".
2. Where AMO asks how to distribute, choose **On this site** (listed on addons.mozilla.org). Don't choose "On your own": self-distributed builds aren't covered by this guide.
3. Upload `dist/browser-sidekick-<version>-firefox.zip`.
4. Compatibility: tick Firefox only, leave Firefox for Android unticked (`docs/store/amo.md`, "Listing", Compatibility).
5. AMO validates the package. Errors stop the upload; warnings don't. `npm run lint:firefox` shows the same warnings locally; only errors need fixing.

### 3. Source code

1. When AMO asks whether you need to submit source code, answer **Yes**: the package is bundled and contains minified third-party code.
2. Upload `dist/browser-sidekick-<version>-sources.zip`.
3. Paste the build instructions block from `docs/store/amo.md`, section "Source code", into the field AMO gives for them, or into "Notes to reviewer" if there is no separate field (check the current form).

### 4. Listing details

From `docs/store/amo.md`, section "Listing", which points to the listing files:

| Form field                       | Use                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Name                             | taken from the package (Browser Sidekick)                                                                                    |
| Add-on URL                       | your choice, for example `browser-sidekick`                                                                                  |
| Summary                          | section "AMO summary" of `docs/store/listing.en.md`                                                                          |
| Description                      | section "Full description" of `docs/store/listing.en.md`                                                                     |
| Categories                       | section "Category" of `docs/store/listing.en.md` (AMO line)                                                                  |
| Support email                    | `feedback@findach.de`                                                                                                        |
| Support website                  | section "Support" of `docs/store/listing.en.md`                                                                              |
| License                          | MIT ("The MIT License"; text in `LICENSE`)                                                                                   |
| This add-on has a privacy policy | tick it, then paste the whole of `PRIVACY.md` (see `docs/store/amo.md`, "Privacy policy")                                    |
| Notes to reviewer                | the block in `docs/store/amo.md`, "Notes to reviewer", followed by the build instructions if you didn't paste them in step 3 |

Then submit the version.

### 5. Product page (after submitting)

Open "Edit Product Page" for the add-on:

1. Screenshots: `docs/store/assets/screenshot-1-answer.en.png` to `screenshot-4-settings.en.png`, in that order. AMO doesn't use the promo tile.
2. Homepage: section "Homepage" of `docs/store/listing.en.md`.
3. Privacy policy: check the preview. If Markdown marks such as `**` or backticks show literally, remove only those marks; the wording stays as in the file.
4. German: switch the locale of the page to Deutsch (check the current form for the locale selector) and fill the summary and description from sections "AMO summary" and "Full description" of `docs/store/listing.de.md`, the privacy policy from `PRIVACY.de.md`, and the screenshots `screenshot-*.de.png`.
5. The icon comes from the package; there is nothing to upload.

### 6. Review

1. AMO may publish a listed add-on after its automated checks and review it by hand afterwards, or hold it until a reviewer has looked at it, especially when source code is attached. Check the add-on's status in the Developer Hub; review time varies.
2. The data Firefox shows at install time comes from the package's `data_collection_permissions`. `docs/store/amo.md`, "Data collection permissions", explains each of the four categories if a reviewer asks.
3. Reviewer questions arrive by email and in the Developer Hub. Answer from `docs/store/amo.md` ("Permissions", "Data collection permissions", "Source code") and `PRIVACY.md`. A reviewer who can't rebuild the package should be pointed to the build instructions; `npm run verify:zips` shows that the sources zip rebuilds it exactly. If a reviewer asks for a change to the add-on itself, that needs a decision and a new version, as for Chrome.

## After the listings are live

1. Update the status line at the top of `README.md` (it says the extension isn't in either store yet) and add the store links to the Install section.
2. Keep `docs/store/` in step with the code: when permissions, stored data or features change, update `PRIVACY.md`, `PRIVACY.de.md`, the listing files and the store answers in the same change, and regenerate the images with `npm run store:assets`.

## Shipping an update

1. Bump the version: `npm version <new-version> --no-git-tag-version` sets `version` in `package.json` and `package-lock.json`. Both stores reject a version they already have.
2. Rebuild and commit the builds: `npm run build`, then commit `dist/chrome-ext` and `dist/firefox-ext` (`npm run check:dist` must pass afterwards). Update the version in the `README.md` status line.
3. Merge to `main`, then build the zips from `main`: `npm run zip` and `npm run verify:zips`, as in "Before you start".
4. If the update changes the listing, permissions or data handling, update `docs/store/`, the privacy policies and the images first (see "After the listings are live"), and change the same fields in both dashboards.
5. Chrome: open the item in the developer dashboard, go to the package tab, upload the new `dist/browser-sidekick-<version>-chrome.zip`, and submit for review. A new or changed permission may trigger a longer review and asks users to approve it.
6. AMO: in the Developer Hub, choose "Upload New Version", upload the new `dist/browser-sidekick-<version>-firefox.zip`, answer Yes to source code and upload the new `dist/browser-sidekick-<version>-sources.zip` with the build instructions from `docs/store/amo.md` (update the Node.js and npm versions there if you built with different ones), and add release notes.
7. Never change the Firefox add-on ID (`browser-sidekick@wolffischer82.github.io` in `wxt.config.ts`): AMO identifies the add-on by it.
