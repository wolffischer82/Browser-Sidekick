import { afterEach, describe, expect, it, vi } from 'vitest';
import { assembleContext } from '@/shared/chat/context';
import {
  pinWait,
  summarizeState,
  summaryPageSet,
  waitForPins,
  type SummaryPageSet,
} from '@/shared/chat/summarize';
import type { CurrentTab } from '@/shared/current-tab';
import { DEFAULT_CONTEXT_BUDGET, type Pin, type ProviderConfig } from '@/shared/model';

// Summarize (spec 5.6, D4): which pages a summary covers, the button's
// state, and the short wait for pins that are still being read.

function pin(n: number, patch: Partial<Pin> = {}): Pin {
  return {
    id: `pin-${String(n)}`,
    sessionId: 's',
    position: n,
    url: `https://site${String(n)}.example/page`,
    title: `Page ${String(n)}`,
    faviconUrl: null,
    kind: 'page',
    text: `Text of page ${String(n)}.`,
    charCount: 0,
    truncated: false,
    status: 'ready',
    extractedAt: 1,
    failureReason: null,
    createdAt: 1,
    ...patch,
  };
}

const TAB_URL = 'https://current.example/';

const readable = (url = TAB_URL): CurrentTab => ({
  state: 'readable',
  tabId: 7,
  windowId: 1,
  url,
  title: 'Current page',
  faviconUrl: null,
  siteAccess: true,
});

const NONE: CurrentTab = { state: 'none' };
const RESTRICTED: CurrentTab = {
  state: 'restricted',
  tabId: 7,
  windowId: 1,
  url: 'chrome://settings/',
  title: 'Settings',
};
const NO_ACCESS: CurrentTab = { state: 'noAccess', tabId: 7, windowId: 1 };

interface Row {
  name: string;
  pins: Pin[];
  tab: CurrentTab;
  excluded: boolean;
  /** Citation numbers of the pins covered. */
  pinNumbers: number[];
  /** Whether the current tab is covered as an extra page. */
  tabCovered: boolean;
}

const ROWS: Row[] = [
  {
    name: 'pins only',
    pins: [pin(1), pin(2)],
    tab: NONE,
    excluded: false,
    pinNumbers: [1, 2],
    tabCovered: false,
  },
  {
    name: 'current tab only',
    pins: [],
    tab: readable(),
    excluded: false,
    pinNumbers: [],
    tabCovered: true,
  },
  {
    name: 'pins and the current tab',
    pins: [pin(1), pin(2)],
    tab: readable(),
    excluded: false,
    pinNumbers: [1, 2],
    tabCovered: true,
  },
  {
    name: 'current tab already pinned',
    pins: [pin(1), pin(2, { url: TAB_URL })],
    tab: readable(),
    excluded: false,
    pinNumbers: [1, 2],
    tabCovered: false,
  },
  {
    name: 'current tab already pinned, with another fragment',
    pins: [pin(1, { url: `${TAB_URL}#intro` })],
    tab: readable(`${TAB_URL}#end`),
    excluded: false,
    pinNumbers: [1],
    tabCovered: false,
  },
  {
    name: 'current tab excluded',
    pins: [pin(1)],
    tab: readable(),
    excluded: true,
    pinNumbers: [1],
    tabCovered: false,
  },
  {
    name: 'current tab excluded and nothing pinned',
    pins: [],
    tab: readable(),
    excluded: true,
    pinNumbers: [],
    tabCovered: false,
  },
  {
    name: 'a failed and an extracting pin are left out',
    pins: [pin(1, { status: 'failed' }), pin(2), pin(3, { status: 'extracting' })],
    tab: readable(),
    excluded: false,
    pinNumbers: [2],
    tabCovered: true,
  },
  {
    name: 'only pins that are not ready, no tab',
    pins: [pin(1, { status: 'failed' }), pin(2, { status: 'extracting' })],
    tab: NONE,
    excluded: false,
    pinNumbers: [],
    tabCovered: false,
  },
  {
    name: 'a restricted current tab',
    pins: [pin(1)],
    tab: RESTRICTED,
    excluded: false,
    pinNumbers: [1],
    tabCovered: false,
  },
  {
    name: 'a current tab without access',
    pins: [],
    tab: NO_ACCESS,
    excluded: false,
    pinNumbers: [],
    tabCovered: false,
  },
  {
    name: 'nothing at all',
    pins: [],
    tab: NONE,
    excluded: false,
    pinNumbers: [],
    tabCovered: false,
  },
];

describe('summaryPageSet (D4)', () => {
  it.each(ROWS)('$name', ({ pins, tab, excluded, pinNumbers, tabCovered }) => {
    const set = summaryPageSet(pins, tab, excluded);
    expect(set.pins.map((p) => p.position)).toEqual(pinNumbers);
    expect(set.currentTab !== null).toBe(tabCovered);
    expect(set.count).toBe(pinNumbers.length + (tabCovered ? 1 : 0));
    if (tabCovered)
      expect(set.currentTab).toEqual({ tabId: 7, url: TAB_URL, title: 'Current page' });

    // The request built from the same input carries exactly this set.
    const context = assembleContext({
      pins,
      currentTab: set.currentTab ? { ...set.currentTab, text: 'Tab text.' } : null,
      history: [],
      question: 'Summarize.',
      budgetTokens: DEFAULT_CONTEXT_BUDGET,
    });
    const expected = [
      ...pinNumbers.map((n) => ({ index: n, origin: 'pin' })),
      ...(tabCovered ? [{ index: pins.length + 1, origin: 'currentTab' }] : []),
    ];
    expect(context.sources.map(({ index, origin }) => ({ index, origin }))).toEqual(expected);
  });
});

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'anthropic',
    label: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'k',
    defaultModel: 'm',
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    cachedModels: null,
    hasAccess: true,
    ...patch,
  };
}

describe('summarizeState', () => {
  const some: SummaryPageSet = summaryPageSet([pin(1)], NONE, false);
  const nothing: SummaryPageSet = summaryPageSet([], NONE, false);

  it('is ready with a usable provider, a model, pages and no answer on its way', () => {
    expect(summarizeState({ provider: provider(), model: 'm', busy: false, pages: some })).toEqual({
      kind: 'ready',
    });
  });

  it('names the missing provider first', () => {
    expect(
      summarizeState({ provider: undefined, model: null, busy: false, pages: nothing }),
    ).toEqual({ kind: 'noProvider' });
    expect(summarizeState({ provider: provider(), model: null, busy: false, pages: some })).toEqual(
      { kind: 'noProvider' },
    );
  });

  it('names a provider without access', () => {
    expect(
      summarizeState({
        provider: provider({ hasAccess: false, label: 'Local' }),
        model: 'm',
        busy: false,
        pages: some,
      }),
    ).toEqual({ kind: 'noAccess', providerLabel: 'Local' });
  });

  it('is busy while an answer is on its way', () => {
    expect(summarizeState({ provider: provider(), model: 'm', busy: true, pages: some })).toEqual({
      kind: 'busy',
    });
  });

  it('has nothing to summarise without a page', () => {
    expect(
      summarizeState({ provider: provider(), model: 'm', busy: false, pages: nothing }),
    ).toEqual({ kind: 'nothing' });
  });
});

describe('waitForPins', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns at once when no pin is extracting', async () => {
    const list = vi.fn(() => Promise.resolve([pin(1), pin(2, { status: 'failed' })]));
    const onWait = vi.fn();
    const result = await waitForPins(list, new AbortController().signal, onWait);
    expect(result.pins.map((p) => p.position)).toEqual([1, 2]);
    expect(result.stillExtracting).toBe(0);
    expect(list).toHaveBeenCalledTimes(1);
    expect(onWait).not.toHaveBeenCalled();
  });

  it('waits until the extracting pin is ready', async () => {
    vi.useFakeTimers();
    let status: Pin['status'] = 'extracting';
    const list = vi.fn(() => Promise.resolve([pin(1, { status })]));
    const onWait = vi.fn();
    const waiting = waitForPins(list, new AbortController().signal, onWait);
    await vi.advanceTimersByTimeAsync(pinWait.pollMs * 2);
    expect(onWait).toHaveBeenCalledTimes(1);
    status = 'ready';
    await vi.advanceTimersByTimeAsync(pinWait.pollMs);
    const result = await waiting;
    expect(result.pins[0]?.status).toBe('ready');
    expect(result.stillExtracting).toBe(0);
  });

  it('gives up after the time limit and reports the pins still extracting', async () => {
    vi.useFakeTimers();
    const list = vi.fn(() =>
      Promise.resolve([pin(1), pin(2, { status: 'extracting' }), pin(3, { status: 'extracting' })]),
    );
    const waiting = waitForPins(list, new AbortController().signal, () => undefined);
    await vi.advanceTimersByTimeAsync(pinWait.timeoutMs + pinWait.pollMs);
    const result = await waiting;
    expect(result.stillExtracting).toBe(2);
    expect(result.pins).toHaveLength(3);
  });

  it('stops waiting when the request is stopped', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const list = vi.fn(() => Promise.resolve([pin(1, { status: 'extracting' })]));
    const waiting = waitForPins(list, controller.signal, () => undefined);
    await vi.advanceTimersByTimeAsync(pinWait.pollMs);
    controller.abort();
    await vi.advanceTimersByTimeAsync(pinWait.pollMs);
    const calls = list.mock.calls.length;
    await waiting;
    await vi.advanceTimersByTimeAsync(pinWait.timeoutMs);
    expect(list.mock.calls.length).toBe(calls);
  });
});
