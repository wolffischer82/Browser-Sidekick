// Installs the IndexedDB globals the repository needs.
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/sidepanel/App';
import { openRepository, type Repository } from '@/shared/db/repository';
import { useLocale, type Locale } from './i18n';
import { fakePermissions } from './permissions';

/** The extension version the fake browser's manifest reports. */
export const TEST_VERSION = '9.8.7';

/**
 * A fresh browser, locale and empty IndexedDB, with a clock that ticks per
 * call. Host permissions start as installed: the three native provider hosts.
 */
export async function freshRepository(locale: Locale = 'en'): Promise<Repository> {
  fakeBrowser.reset();
  // The fake browser has no manifest; the settings footer shows its version.
  fakeBrowser.runtime.getManifest = () => ({
    manifest_version: 3,
    name: 'Browser Sidekick',
    version: TEST_VERSION,
  });
  useLocale(locale);
  fakePermissions();
  globalThis.indexedDB = new IDBFactory();
  let clock = Date.now() - 60 * 60 * 1000;
  return openRepository({ now: () => (clock += 1000) });
}

/** Renders the sidebar and waits until the active session is shown. */
export async function renderSidebar(repo: Repository): Promise<void> {
  render(<App repository={Promise.resolve(repo)} />);
  await screen.findByTitle('Rename session');
}

/** The header's title button. */
export function titleButton(): HTMLElement {
  return screen.getByTitle('Rename session');
}
