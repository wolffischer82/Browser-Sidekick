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

  it('every message has a description', () => {
    for (const locale of ['en', 'de'] as const) {
      for (const [key, value] of Object.entries(readMessages(locale))) {
        expect(value.description?.trim(), `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('each summary level has its prompt, ending with the answer language', () => {
    const keys = [
      'summarizePromptVeryShort',
      'summarizePromptShort',
      'summarizePrompt',
      'summarizePromptDetailed',
    ];
    const ending = { en: 'Answer in English.', de: 'Antworte auf Deutsch.' } as const;
    for (const locale of ['en', 'de'] as const) {
      const messages = readMessages(locale);
      const prompts = keys.map((key) => messages[key]?.message ?? '');
      for (const prompt of prompts) expect(prompt.endsWith(ending[locale])).toBe(true);
      expect(new Set(prompts).size).toBe(keys.length);
    }
  });
});
