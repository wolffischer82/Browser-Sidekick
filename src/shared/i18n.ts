import { browser } from 'wxt/browser';

/** Message keys, typed from `public/_locales/en/messages.json` (type-only import). */
export type MessageKey = keyof typeof import('../../public/_locales/en/messages.json');

/**
 * Returns the localised string for `key` in the browser's UI language.
 * `substitutions` fill the message's `$1`-based placeholders.
 */
export function t(key: MessageKey, ...substitutions: string[]): string {
  return substitutions.length > 0
    ? browser.i18n.getMessage(key, substitutions)
    : browser.i18n.getMessage(key);
}

/** The browser's UI language, for `Intl` formatting. */
export function uiLanguage(): string {
  return browser.i18n.getUILanguage();
}
