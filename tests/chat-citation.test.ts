import { afterEach, describe, expect, it, vi } from 'vitest';
import { citationNumber, currentTabCitationNumber } from '@/shared/chat/citation';
import { assembleContext } from '@/shared/chat/context';
import type { Pin } from '@/shared/model';

// The citation-number helper (redesign spec 5.2) that the Session tabs list
// and the context assembly share, so the numbers on the rows and in the
// request can't drift. The module is wrapped in spies to show that
// `assembleContext` takes its numbers from it.

vi.mock('@/shared/chat/citation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/chat/citation')>();
  return {
    citationNumber: vi.fn(actual.citationNumber),
    currentTabCitationNumber: vi.fn(actual.currentTabCitationNumber),
  };
});

function pin(n: number, status: Pin['status'] = 'ready'): Pin {
  return {
    id: `pin-${String(n)}`,
    sessionId: 's',
    position: n,
    url: `https://site${String(n)}.example/`,
    title: `Page ${String(n)}`,
    faviconUrl: null,
    kind: 'page',
    text: status === 'ready' ? `Text ${String(n)}` : '',
    charCount: 0,
    truncated: false,
    status,
    extractedAt: status === 'ready' ? 1 : null,
    failureReason: status === 'failed' ? 'empty' : null,
    createdAt: 1,
  };
}

const ask = (pins: Pin[], withTab: boolean) =>
  assembleContext({
    pins,
    currentTab: withTab ? { title: 'Tab', url: 'https://tab.example/', text: 'Tab text' } : null,
    history: [],
    question: 'Q',
    budgetTokens: 100_000,
  });

afterEach(() => {
  vi.mocked(citationNumber).mockClear();
  vi.mocked(currentTabCitationNumber).mockClear();
});

describe('citation numbers', () => {
  it('number pins by their position in pin order, from 1', () => {
    expect([0, 1, 2, 9].map(citationNumber)).toEqual([1, 2, 3, 10]);
  });

  it('give the current tab the number after every pin', () => {
    expect(currentTabCitationNumber(0)).toBe(1);
    expect(currentTabCitationNumber(4)).toBe(5);
  });
});

describe('assembleContext', () => {
  it('takes its numbers from the helper', () => {
    vi.mocked(citationNumber).mockImplementation((position) => position + 101);
    vi.mocked(currentTabCitationNumber).mockImplementation((count) => count + 201);
    try {
      const ctx = ask([pin(1), pin(2)], true);
      expect(ctx.sources.map((s) => s.index)).toEqual([101, 102, 203]);
      expect(ctx.system).toContain('<<<PAGE 101>>>');
      expect(ctx.system).toContain('<<<PAGE 203>>>');
    } finally {
      vi.mocked(citationNumber).mockRestore();
      vi.mocked(currentTabCitationNumber).mockRestore();
    }
  });

  it('keeps the numbers of non-ready pins: their pages are skipped, not renumbered', () => {
    const ctx = ask([pin(1), pin(2, 'extracting'), pin(3, 'failed'), pin(4)], true);
    expect(ctx.sources.map((s) => [s.index, s.title])).toEqual([
      [citationNumber(0), 'Page 1'],
      [citationNumber(3), 'Page 4'],
      [currentTabCitationNumber(4), 'Tab'],
    ]);
    expect(ctx.sources.map((s) => s.index)).toEqual([1, 4, 5]);
  });

  it('sends no current-tab number when the tab is not sent', () => {
    const ctx = ask([pin(1), pin(2)], false);
    expect(ctx.sources.map((s) => s.index)).toEqual([1, 2]);
  });
});
