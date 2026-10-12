import { defineConfig } from '@playwright/test';

// `npm run store:screens`: renders the store screenshots (store/screenshots.spec.ts).
export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  reporter: 'list',
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 10_000 },
});
