import { browser } from 'wxt/browser';
import type { ProviderConfig } from './model';
import { normaliseDefault, providerOriginPattern } from './providers';
import { getSettings, updateSettings } from './settings';

/**
 * Host access for provider servers (spec 5.7, D6; decisions.md T05).
 * Custom OpenAI-compatible origins are requested when saved. The three
 * native hosts are declared in the manifest but can be revoked, and a
 * Firefox update doesn't grant new host permissions (decisions.md T04-10),
 * so they are checked the same way.
 */

/** Chrome match patterns may carry a port; Firefox ones can't (MDN "Match patterns"). */
const INCLUDE_PORT = !import.meta.env.FIREFOX;

/** The pattern to check or request for a provider; `null` for an invalid base URL. */
export function accessPattern(provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>): string | null {
  return providerOriginPattern(provider, INCLUDE_PORT);
}

/** Whether the extension may contact `pattern`; `false` if the check fails. */
export async function hasHostAccess(pattern: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Asks the browser for `pattern`. Must be called synchronously from the
 * click that caused it: Firefox rejects the request after an `await`.
 * Resolves `false` when declined or when the browser refuses to ask.
 */
export function requestHostAccess(pattern: string): Promise<boolean> {
  try {
    return browser.permissions.request({ origins: [pattern] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Rechecks every saved provider's host access and stores changes, keeping
 * one usable default (spec 5.7). Runs when the sidebar opens and when the
 * browser's permissions change.
 */
export async function syncProviderAccess(): Promise<void> {
  const { providers, defaultProviderId } = await getSettings();
  const access = await Promise.all(
    providers.map(async (p) => {
      const pattern = accessPattern(p);
      return pattern ? hasHostAccess(pattern) : false;
    }),
  );
  if (providers.every((p, i) => p.hasAccess === access[i])) return;
  const updated = providers.map((p, i) => ({ ...p, hasAccess: access[i] ?? false }));
  await updateSettings({
    providers: updated,
    defaultProviderId: normaliseDefault(updated, defaultProviderId),
  });
}

/** Calls `listener` when host permissions are granted or revoked. */
export function watchHostAccess(listener: () => void): () => void {
  const onChange = () => {
    listener();
  };
  try {
    browser.permissions.onAdded.addListener(onChange);
    browser.permissions.onRemoved.addListener(onChange);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      browser.permissions.onAdded.removeListener(onChange);
      browser.permissions.onRemoved.removeListener(onChange);
    } catch {
      // The page is going away; nothing is left to stop.
    }
  };
}
