import type { ProviderConfig } from './model';
import { normaliseDefault } from './providers';
import { getSettings, updateSettings } from './settings';

/**
 * Provider writes for the settings view (spec 5.7). Each write stores the
 * provider list and the default together, so one usable provider is always
 * the default while any usable provider exists.
 */

async function commit(providers: ProviderConfig[], defaultId: string | null): Promise<void> {
  await updateSettings({ providers, defaultProviderId: normaliseDefault(providers, defaultId) });
}

/** Adds the provider, or replaces the saved one with the same id. */
export async function storeProvider(provider: ProviderConfig): Promise<void> {
  const { providers, defaultProviderId } = await getSettings();
  const index = providers.findIndex((p) => p.id === provider.id);
  if (index === -1) providers.push(provider);
  else providers[index] = provider;
  await commit(providers, defaultProviderId);
}

/**
 * Deletes the provider with its key. If it was the default, the first
 * usable provider becomes the default. Sessions on it move to the default
 * when they are next shown (`resolveSessionModel`).
 */
export async function removeProvider(id: string): Promise<void> {
  const { providers, defaultProviderId } = await getSettings();
  await commit(
    providers.filter((p) => p.id !== id),
    defaultProviderId === id ? null : defaultProviderId,
  );
}

/** Makes a usable provider the default; a provider without access is ignored. */
export async function makeDefaultProvider(id: string): Promise<void> {
  const { providers, defaultProviderId } = await getSettings();
  const target = providers.find((p) => p.id === id);
  await commit(providers, target?.hasAccess ? id : defaultProviderId);
}

/** Records the result of an access request for one provider. */
export async function setProviderAccess(id: string, hasAccess: boolean): Promise<void> {
  const { providers, defaultProviderId } = await getSettings();
  await commit(
    providers.map((p) => (p.id === id ? { ...p, hasAccess } : p)),
    defaultProviderId,
  );
}
