import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where the store assets live (committed). */
export const ASSETS_DIR = resolve(import.meta.dirname, '../../docs/store/assets');

/** Required sizes (spec store-publishing 4.4). */
export const SCREENSHOT_SIZE = { width: 1280, height: 800 };
export const PROMO_SIZE = { width: 440, height: 280 };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk; throws if the data isn't a PNG. */
export function pngSize(data: Buffer): { width: number; height: number } {
  if (data.length < 24 || !data.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Not a PNG file.');
  }
  if (data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG without IHDR.');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** The size an asset must have, from its file name; `null` for an unknown name. */
export function requiredSize(name: string): { width: number; height: number } | null {
  if (/^screenshot-\d+-[a-z-]+\.(en|de)\.png$/.test(name)) return SCREENSHOT_SIZE;
  if (/^promo-small\.(en|de)\.png$/.test(name)) return PROMO_SIZE;
  return null;
}

/** Every asset whose name is unknown or whose size is wrong, as messages. */
export function sizeProblems(dir = ASSETS_DIR): string[] {
  const problems: string[] = [];
  for (const name of readdirSync(dir)) {
    const want = requiredSize(name);
    if (!want) {
      problems.push(`${name}: unexpected file`);
      continue;
    }
    const got = pngSize(readFileSync(resolve(dir, name)));
    if (got.width !== want.width || got.height !== want.height) {
      problems.push(
        `${name}: ${String(got.width)}×${String(got.height)}, needs ${String(want.width)}×${String(want.height)}`,
      );
    }
  }
  return problems;
}
