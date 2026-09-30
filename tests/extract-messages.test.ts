import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extractionFailureMessage } from '@/shared/extract/messages';
import { readMessages, useLocale, type Locale } from './helpers/i18n';

describe('extractionFailureMessage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it.each<Locale>(['en', 'de'])('localises every reason (%s)', (locale) => {
    useLocale(locale);
    const m = readMessages(locale);
    expect(extractionFailureMessage('restricted')).toBe(m.extractFailedRestricted?.message);
    expect(extractionFailureMessage('no-access')).toBe(m.extractFailedNoAccess?.message);
    expect(extractionFailureMessage('empty')).toBe(m.extractFailedEmpty?.message);
    expect(extractionFailureMessage('unreadable')).toBe(m.extractFailedUnreadable?.message);
  });

  it('falls back for an unknown stored reason', () => {
    useLocale('en');
    expect(extractionFailureMessage('something-else')).toBe(
      "The page couldn't be read. Reload it and try again.",
    );
  });
});
