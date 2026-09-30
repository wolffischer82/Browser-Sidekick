// Renders design/icon.svg to the PNG sizes the manifests use
// (public/icon/<size>.png) with Playwright's Chromium.
// To replace the artwork: edit or replace design/icon.svg, run
// `npm run icons`, rebuild. No code changes are needed.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ICON_SIZES = [16, 32, 48, 96, 128];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(root, 'design/icon.svg'), 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of ICON_SIZES) {
    await page.setViewportSize({ width: size, height: size });
    const sized = svg.replace('width="128" height="128"', `width="${size}" height="${size}"`);
    await page.setContent(
      `<!doctype html><body style="margin:0;background:transparent">${sized}</body>`,
    );
    await page.screenshot({
      path: resolve(root, 'public/icon', `${size}.png`),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
  }
} finally {
  await browser.close();
}
