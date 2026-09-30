import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '@/entrypoints/sidepanel/App';
import { readMessages, useLocale, type Locale } from './helpers/i18n';

afterEach(() => {
  cleanup();
});

describe('sidebar root', () => {
  it.each<Locale>(['en', 'de'])('renders the localised heading (%s)', (locale) => {
    useLocale(locale);
    render(<App />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(readMessages(locale).sidebarHeading?.message);
    expect(heading.textContent).toBe('Browser Sidekick');
  });
});
