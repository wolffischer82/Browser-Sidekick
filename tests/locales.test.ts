import { describe, expect, it } from 'vitest';
import { readMessages } from './helpers/i18n';

describe('locales', () => {
  it('en and de define the same message keys', () => {
    const en = Object.keys(readMessages('en')).sort();
    const de = Object.keys(readMessages('de')).sort();
    expect(de).toEqual(en);
  });

  it('no message is empty', () => {
    for (const locale of ['en', 'de'] as const) {
      for (const [key, value] of Object.entries(readMessages(locale))) {
        expect(value.message.trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });
});
