// @vitest-environment node
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'wxt';

const root = resolve(__dirname, '..');
const PROVIDER_HOSTS = [
  'https://api.openai.com/*',
  'https://api.anthropic.com/*',
  'https://generativelanguage.googleapis.com/*',
];
const outDirs: string[] = [];
const built: Partial<Record<'chrome' | 'firefox', string>> = {};

async function exists(browser: 'chrome' | 'firefox', file: string): Promise<boolean> {
  const dir = built[browser];
  if (!dir) throw new Error(`No ${browser} build yet.`);
  return access(join(dir, file)).then(
    () => true,
    () => false,
  );
}

async function buildManifest(browser: 'chrome' | 'firefox'): Promise<Record<string, unknown>> {
  const outDir = await mkdtemp(join(tmpdir(), `sidekick-manifest-${browser}-`));
  outDirs.push(outDir);
  await build({
    root,
    browser,
    outDir,
    logger: {
      debug() {},
      log() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      success() {},
      level: 0,
    },
  });
  built[browser] = join(outDir, `${browser}-ext`);
  const file = join(outDir, `${browser}-ext`, 'manifest.json');
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

afterAll(async () => {
  await Promise.all(outDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('manifest', () => {
  it('chrome: exact permissions and snapshot', async () => {
    const manifest = await buildManifest('chrome');
    expect(manifest.permissions).toEqual([
      'storage',
      'activeTab',
      'scripting',
      'contextMenus',
      'offscreen',
      'sidePanel',
    ]);
    expect(manifest.host_permissions).toEqual(PROVIDER_HOSTS);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.optional_permissions).toBeUndefined();
    // T09: the default MV3 CSP stays; pdf.js and its worker are packaged files.
    expect(manifest.content_security_policy).toBeUndefined();
    expect(await exists('chrome', 'offscreen.html')).toBe(true);
    expect(await exists('chrome', 'pdf.worker.js')).toBe(true);
    expect(manifest).toMatchSnapshot();
  }, 60_000);

  it('firefox: exact permissions and snapshot', async () => {
    const manifest = await buildManifest('firefox');
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting', 'contextMenus']);
    expect(manifest.host_permissions).toEqual(PROVIDER_HOSTS);
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest.browser_specific_settings).toMatchObject({
      gecko: {
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['websiteContent', 'browsingActivity'] },
      },
    });
    expect(manifest.sidebar_action).toMatchObject({
      default_title: '__MSG_extName__',
      open_at_install: false,
    });
    expect(manifest.content_security_policy).toBeUndefined();
    expect(await exists('firefox', 'offscreen.html')).toBe(false);
    expect(await exists('firefox', 'pdf.worker.js')).toBe(true);
    expect(manifest).toMatchSnapshot();
  }, 60_000);
});
