import { defineConfig } from '@playwright/test';

// Chrome e2e suite (spec 9 "Browser automation"). Loads dist/chrome-ext, so
// `npm run build:chrome` must run first; the verification gate builds before e2e.
// Each test launches its own persistent Chromium profile (tests/e2e/extension.ts).
export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 5_000 },
});
