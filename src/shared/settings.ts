import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type ProviderConfig, type Settings } from './model';

/**
 * Settings store over `storage.local` (spec 6 "Storage", D5). Each field is
 * its own storage key, so writes from the sidebar and the background never
 * overwrite each other's fields. Nothing here uses sync storage.
 */

type SettingsKey = keyof Settings;

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingsKey[];

function defaults(): Settings {
  return { ...DEFAULT_SETTINGS, providers: [] };
}

/** Reads all settings; missing keys fall back to their defaults. */
export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get<Partial<Settings>>(SETTINGS_KEYS);
  const settings = defaults();
  for (const key of SETTINGS_KEYS) {
    if (stored[key] !== undefined) Object.assign(settings, { [key]: stored[key] });
  }
  return settings;
}

/** Writes the given fields and leaves the others untouched. */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const items: Partial<Settings> = {};
  for (const key of SETTINGS_KEYS) {
    if (patch[key] !== undefined) Object.assign(items, { [key]: patch[key] });
  }
  if (Object.keys(items).length > 0) await browser.storage.local.set(items);
}

/** Adds the provider, or replaces the saved one with the same id. */
export async function saveProvider(provider: ProviderConfig): Promise<void> {
  const { providers } = await getSettings();
  const index = providers.findIndex((p) => p.id === provider.id);
  if (index === -1) providers.push(provider);
  else providers[index] = provider;
  await updateSettings({ providers });
}

/** Removes the provider; if it was the default, no provider is default afterwards. */
export async function deleteProvider(id: string): Promise<void> {
  const { providers, defaultProviderId } = await getSettings();
  await browser.storage.local.set({
    providers: providers.filter((p) => p.id !== id),
    defaultProviderId: defaultProviderId === id ? null : defaultProviderId,
  });
}

/**
 * The settings part of Delete all data (D12): forgets the active session and,
 * when `includeProviders` is set, every provider with its key. The Session
 * tabs and access-banner states are kept.
 */
export async function clearSettingsForDeleteAll(options: {
  includeProviders: boolean;
}): Promise<void> {
  const keys: SettingsKey[] = ['activeSessionId'];
  if (options.includeProviders) keys.push('providers', 'defaultProviderId');
  await browser.storage.local.remove(keys);
}

/**
 * Calls `listener` with the changed fields whenever settings change in any
 * extension context. Returns a function that stops listening.
 */
export function watchSettings(listener: (changed: Partial<Settings>) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string): void => {
    if (areaName !== 'local') return;
    const changed: Partial<Settings> = {};
    const fallback = defaults();
    for (const key of SETTINGS_KEYS) {
      const change = changes[key];
      if (change) Object.assign(changed, { [key]: change.newValue ?? fallback[key] });
    }
    if (Object.keys(changed).length > 0) listener(changed);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => {
    browser.storage.onChanged.removeListener(onChanged);
  };
}
