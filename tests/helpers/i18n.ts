import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

export type Locale = 'en' | 'de';

type Messages = Record<string, { message: string; description?: string }>;

export function readMessages(locale: Locale): Messages {
  const file = resolve(__dirname, '../../public/_locales', locale, 'messages.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Messages;
}

/**
 * fakeBrowser does not implement `i18n`; this stubs it with the real
 * messages of `locale`, as the browser would for that UI language.
 */
export function useLocale(locale: Locale): void {
  const messages = readMessages(locale);
  vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation(
    (key: string) => messages[key]?.message ?? '',
  );
  vi.spyOn(fakeBrowser.i18n, 'getUILanguage').mockReturnValue(locale);
}
