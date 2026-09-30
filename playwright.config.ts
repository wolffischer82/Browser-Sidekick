import { defineConfig } from '@playwright/test';

// The Chrome e2e smoke against the mock LLM server arrives in T12.
export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'list',
});
