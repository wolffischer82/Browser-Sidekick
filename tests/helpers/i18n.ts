import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

export type Locale = 'en' | 'de';

interface MessageEntry {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string }>;
}

type Messages = Record<string, MessageEntry>;

/** Resolves `$NAME$` placeholders and their `$n` contents like `i18n.getMessage`. */
export function formatMessage(
  entry: MessageEntry | undefined,
  substitutions: string[] = [],
): string {
  if (!entry) return '';
  const fill = (text: string): string =>
    text.replace(/\$(\d)/g, (_match, n: string) => substitutions[Number(n) - 1] ?? '');
  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (match, name: string) => {
    const placeholder = entry.placeholders?.[name.toLowerCase()];
    return placeholder ? fill(placeholder.content) : match;
  });
}

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
    (key: string, substitutions?: string | string[]) =>
      formatMessage(
        messages[key],
        typeof substitutions === 'string' ? [substitutions] : (substitutions ?? []),
      ),
  );
  vi.spyOn(fakeBrowser.i18n, 'getUILanguage').mockReturnValue(locale);
}
