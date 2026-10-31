import { defineConfig } from '@playwright/test';

// Store screenshots and promo tiles (specs/store-publishing.md 4.4), run by
// `npm run store:assets`, never by `npm run e2e`. Loads dist/chrome-ext like
// the e2e suite, so `npm run build:chrome` runs first. Chromium only: AMO
// accepts the same images.
export default defineConfig({
  testDir: './tests/store',
  testMatch: '*.store.ts',
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { browserName: 'chromium', channel: 'chromium', deviceScaleFactor: 1 },
});
