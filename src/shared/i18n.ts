import { browser } from 'wxt/browser';

/** Message keys defined in `public/_locales/<lang>/messages.json`. */
export type MessageKey = 'extName' | 'extDescription' | 'sidebarHeading';

/** Returns the localised string for `key` in the browser's UI language. */
export function t(key: MessageKey): string {
  return browser.i18n.getMessage(key);
}
