// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'wxt';

const root = resolve(__dirname, '..');
const outDirs: string[] = [];

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
  const file = join(outDir, `${browser}-mv3`, 'manifest.json');
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

afterAll(async () => {
  await Promise.all(outDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('manifest', () => {
  it('chrome: exact permissions and snapshot', async () => {
    const manifest = await buildManifest('chrome');
    expect(manifest.permissions).toEqual(['sidePanel']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
    expect(manifest.optional_permissions).toBeUndefined();
    expect(manifest).toMatchSnapshot();
  }, 60_000);

  it('firefox: exact permissions and snapshot', async () => {
    const manifest = await buildManifest('firefox');
    expect(manifest.permissions).toBeUndefined();
    expect(manifest.host_permissions).toBeUndefined();
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
    expect(manifest).toMatchSnapshot();
  }, 60_000);
});
