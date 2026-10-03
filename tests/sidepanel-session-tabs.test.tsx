import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { App } from '@/entrypoints/sidepanel/App';
import type { Repository } from '@/shared/db/repository';
import type { ExtractionResult } from '@/shared/extract';
import { isSidekickMessage, type SidekickMessage } from '@/shared/messages';
import { handleRequest, type ServiceDeps } from '@/shared/pin-service';
import { getSettings, updateSettings } from '@/shared/settings';
import { readMessages } from './helpers/i18n';
import { NATIVE_HOSTS, fakePermissions, type FakePermissions } from './helpers/permissions';
import { freshRepository, renderSidebar, titleButton } from './helpers/sidebar';

// Session tabs (spec 5.2 item 3, 5.4, D9, D10): pinned rows, the current-tab
// row with needle and eye, the pinned current tab, unreadable tabs, collapse,
// "Already pinned", and live updates from the background.

interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  favIconUrl?: string;
  active: boolean;
}

const ARTICLE: FakeTab = {
  id: 11,
  windowId: 1,
  url: 'https://news.example/trains',
  title: 'Night trains return',
  active: true,
};
const DASHBOARD: FakeTab = {
  id: 12,
  windowId: 1,
  url: 'https://dash.example/',
  title: 'Dashboard',
  active: false,
};

let repo: Repository | undefined;
let perms: FakePermissions;
let tabs: FakeTab[];
/** Tabs readable through `activeTab` only. */
let activeTabGrants: Set<number>;
let extract: ReturnType<typeof vi.fn<ServiceDeps['extract']>>;
/** Broadcasts the sidebar sent. */
let fromSidebar: SidekickMessage[];
/** Requests the sidebar sent to the background, in order. */
let requests: SidekickMessage[];

const ready = (text = 'Text', truncated = false): ExtractionResult => ({
  ok: true,
  kind: 'page',
  title: 'x',
  text,
  charCount: text.length,
  truncated,
});

function covered(url: string): boolean {
  if (!/^https?:/.test(url)) return false;
  const u = new URL(url);
  return perms.granted.has('<all_urls>') || perms.granted.has(`${u.protocol}//${u.hostname}/*`);
}

function reveal(tab: FakeTab) {
  return covered(tab.url) || activeTabGrants.has(tab.id)
    ? tab
    : { id: tab.id, windowId: tab.windowId, active: tab.active };
}

/** Delivers a message to the sidebar's listener, as from the background. */
async function fromBackground(message: SidekickMessage): Promise<void> {
  await deliver(message);
}

/** Runs the sidebar's `runtime.onMessage` listeners with `message`. */
async function deliver(message: unknown): Promise<void> {
  // The sidebar's listener answers nothing.
  const answers: unknown[] = await fakeBrowser.runtime.onMessage.trigger(message, {});
  expect(answers.every((a) => a === undefined)).toBe(true);
}

function fakeBrowserModel(): void {
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 1 } as never);
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((q) => {
    const list = q.active ? tabs.filter((t) => t.active && t.windowId === q.windowId) : tabs;
    return Promise.resolve(list.map(reveal) as never);
  });
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((id) => {
    const tab = tabs.find((t) => t.id === id);
    return tab ? Promise.resolve(reveal(tab) as never) : Promise.reject(new Error('No tab'));
  });
  const deps: ServiceDeps = {
    repo: () => Promise.resolve(repo as Repository),
    extract,
    broadcast: fromBackground,
    browser: 'chrome',
  };
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((message: unknown) => {
    if (!isSidekickMessage(message)) return Promise.reject(new Error('bad'));
    if (message.type === 'pin-tab' || message.type === 'refresh-pin') {
      requests.push(message);
      return handleRequest(deps, message);
    }
    fromSidebar.push(message);
    return Promise.resolve(undefined);
  });
}

async function open(granted: string[] = [...NATIVE_HOSTS, '<all_urls>']): Promise<Repository> {
  repo = await freshRepository();
  perms = fakePermissions(granted);
  fakeBrowserModel();
  await renderSidebar(repo);
  return repo;
}

async function activeSessionId(): Promise<string> {
  return (await getSettings()).activeSessionId ?? '';
}

/** Switches the current tab and fires the browser's event. */
async function activate(tab: FakeTab): Promise<void> {
  tabs = tabs.map((t) => ({ ...t, active: t.id === tab.id }));
  await fakeBrowser.tabs.onActivated.trigger({ tabId: tab.id, windowId: tab.windowId });
}

const heading = (n: number) => screen.findByRole('button', { name: `Session tabs ${String(n)}` });
const rows = () =>
  within(screen.getByRole('list', { name: 'Session tabs' })).getAllByRole('listitem');
const currentRow = () => document.querySelector<HTMLElement>('.tab-row[data-current]');
const pinRow = (title: string) =>
  screen.getByRole('button', { name: `Unpin “${title}”` }).closest('li') as HTMLElement;

beforeEach(() => {
  tabs = [ARTICLE, DASHBOARD];
  activeTabGrants = new Set();
  extract = vi.fn<ServiceDeps['extract']>().mockResolvedValue(ready());
  fromSidebar = [];
  requests = [];
});

afterEach(() => {
  cleanup();
  repo?.close();
});

describe('current-tab row', () => {
  it('has the needle and the eye, marked Current tab, counted once', async () => {
    await open();
    await heading(1);
    const row = currentRow();
    expect(row?.textContent).toContain('Night trains return');
    expect(row?.textContent).toContain('Current tab');
    expect(row?.textContent).toContain('news.example');
    const r = within(row as HTMLElement);
    expect(r.getByRole('button', { name: 'Pin to session' }).title).toBe('Pin to session');
    expect(r.getByRole('button', { name: 'Exclude from questions' })).toBeTruthy();
    expect(screen.getByText('No pinned pages yet.')).toBeTruthy();
  });

  it.each([
    ['not accessible', [...NATIVE_HOSTS], 'Current tab not accessible'],
    ['restricted', [...NATIVE_HOSTS, '<all_urls>'], "This page can't be read"],
  ])('an unreadable tab (%s) has no needle or eye', async (_name, granted, text) => {
    if (text !== 'Current tab not accessible') tabs = [{ ...ARTICLE, url: 'chrome://settings/' }];
    await open(granted);
    await waitFor(() => {
      expect(currentRow()?.textContent).toContain(text);
    });
    expect(screen.queryByRole('button', { name: 'Pin to session' })).toBeNull();
    expect(screen.queryByRole('button', { name: /questions/ })).toBeNull();
  });

  it('the eye excludes and includes the tab, and resets on a tab switch', async () => {
    await open();
    await heading(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Exclude from questions' }));
    const include = await screen.findByRole('button', { name: 'Include in questions' });
    expect(include.title).toBe('Include in questions');
    expect(currentRow()?.className).toContain('tab-row-excluded');
    expect(currentRow()?.textContent).toContain('Not included in questions');

    fireEvent.click(include);
    await screen.findByRole('button', { name: 'Exclude from questions' });
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from questions' }));
    await screen.findByRole('button', { name: 'Include in questions' });

    // Navigation in the same tab keeps it; switching tabs resets it.
    tabs = tabs.map((t) => (t.id === ARTICLE.id ? { ...t, title: 'Night trains, part 2' } : t));
    await fakeBrowser.tabs.onUpdated.trigger(ARTICLE.id, { title: 'x' }, ARTICLE as never);
    await waitFor(() => {
      expect(currentRow()?.textContent).toContain('part 2');
    });
    expect(screen.getByRole('button', { name: 'Include in questions' })).toBeTruthy();

    await activate(DASHBOARD);
    await waitFor(() => {
      expect(currentRow()?.textContent).toContain('Dashboard');
    });
    expect(screen.getByRole('button', { name: 'Exclude from questions' })).toBeTruthy();
    await activate(ARTICLE);
    await waitFor(() => {
      expect(currentRow()?.textContent).toContain('Night trains');
    });
    expect(screen.getByRole('button', { name: 'Exclude from questions' })).toBeTruthy();
  });
});

describe('pinning from the needle', () => {
  it('pins the tab: extracting, then ready; the row shows once with the marker', async () => {
    let finish: (r: ExtractionResult) => void = () => undefined;
    extract.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Pin to session' }));

    await screen.findByRole('button', { name: 'Unpin “Night trains return”' });
    expect(rows()).toHaveLength(1);
    const row = pinRow('Night trains return');
    expect(row.dataset.status).toBe('extracting');
    expect(row.textContent).toContain('Extracting…');
    expect(row.textContent).toContain('Current tab');
    expect(row.textContent).toContain('Page');
    expect(screen.queryByRole('button', { name: 'Pin to session' })).toBeNull();
    await heading(1);
    expect(requests).toEqual([
      { type: 'pin-tab', sessionId: await activeSessionId(), tabId: ARTICLE.id },
    ]);
    // Focus moves to the new row's Unpin button.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Unpin “Night trains return”' }),
      );
    });
    // D11: the first pin names a session that still has its fallback title.
    await waitFor(() => {
      expect(titleButton().textContent).toBe('Night trains return');
    });

    finish(ready('Text', true));
    await waitFor(() => {
      expect(pinRow('Night trains return').dataset.status).toBe('ready');
    });
    expect(pinRow('Night trains return').textContent).toContain('Ready');
    expect(pinRow('Night trains return').textContent).toContain('Truncated');
  });

  it('shows the failure reason of a failed pin', async () => {
    extract.mockResolvedValue({ ok: false, kind: 'page', reason: 'empty' });
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Pin to session' }));
    await waitFor(() => {
      expect(pinRow('Night trains return').dataset.status).toBe('failed');
    });
    const row = pinRow('Night trains return');
    expect(row.textContent).toContain('Failed');
    expect(row.textContent).toContain(readMessages('en').extractFailedEmpty?.message);
  });

  it('asks for the one site first when the tab is readable through activeTab only (D10)', async () => {
    activeTabGrants.add(ARTICLE.id);
    await open([...NATIVE_HOSTS]);
    const needle = await screen.findByRole('button', { name: 'Pin to session' });
    perms.answer = 'decline';
    fireEvent.click(needle);
    // Requested synchronously in the click, before any message.
    expect(perms.requests).toEqual([['https://news.example/*']]);
    expect(requests).toEqual([]);
    // Declined: activeTab still allows this read, so the pin goes ahead.
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    await waitFor(() => {
      expect(pinRow('Night trains return').dataset.status).toBe('ready');
    });
  });

  it('does not ask again when the site is already granted', async () => {
    await open([...NATIVE_HOSTS, 'https://news.example/*']);
    fireEvent.click(await screen.findByRole('button', { name: 'Pin to session' }));
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(perms.requests).toEqual([]);
  });

  it('shows an error when the background refuses', async () => {
    await open();
    const needle = await screen.findByRole('button', { name: 'Pin to session' });
    tabs = tabs.filter((t) => t.id !== ARTICLE.id);
    fireEvent.click(needle);
    expect((await screen.findByRole('alert')).textContent).toBe(
      "The page couldn't be pinned. Reload it and try again.",
    );
  });

  it('shows the save error when the background is unreachable', async () => {
    await open();
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockRejectedValue(new Error('No receiver'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Pin to session' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "The change couldn't be saved. Try again.",
    );
    expect(error).toHaveBeenCalled();
  });
});

describe('pinned rows', () => {
  async function withPins(): Promise<Repository> {
    const r = await open();
    const id = await activeSessionId();
    const a = await r.addPin(id, {
      url: 'https://closed.example/story#part',
      title: 'Closed story',
      kind: 'pdf',
      faviconUrl: 'https://closed.example/icon.png',
    });
    await r.updatePin(a.id, { status: 'ready', text: 'abc', extractedAt: 1 });
    const b = await r.addPin(id, { url: DASHBOARD.url, title: 'Dashboard', kind: 'youtube' });
    await r.updatePin(b.id, { status: 'failed', failureReason: 'no-access' });
    await fromBackground({ type: 'pins-changed', sessionId: id });
    await heading(3);
    return r;
  }

  it('show favicon, title, domain, kind, status and reason, in pin order, then the current tab', async () => {
    await withPins();
    const list = rows();
    expect(list).toHaveLength(3);
    expect(list[0]?.textContent).toContain('Closed story');
    expect(list[0]?.textContent).toContain('closed.example');
    expect(list[0]?.textContent).toContain('PDF');
    expect(list[0]?.textContent).toContain('Ready');
    expect(list[0]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://closed.example/icon.png',
    );
    expect(list[0]?.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(list[1]?.textContent).toContain('YouTube');
    expect(list[1]?.textContent).toContain('Failed');
    expect(list[1]?.textContent).toContain('No access to this site. Allow access and try again.');
    expect(list[1]?.querySelector('.tab-tile-fallback')?.getAttribute('data-fallback')).toBe(
      'youtube',
    );
    expect(list[2]?.dataset.current).toBe('');
    expect(list[2]?.textContent).toContain('Night trains return');
  });

  it('offer Refresh only while the page is open in a tab', async () => {
    await withPins();
    expect(screen.queryByRole('button', { name: 'Refresh “Closed story”' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh “Dashboard”' })).toBeTruthy();

    tabs = [
      ...tabs,
      {
        id: 30,
        windowId: 1,
        url: 'https://closed.example/story',
        title: 'Closed story',
        active: false,
      },
    ];
    await fakeBrowser.tabs.onCreated.trigger({ id: 30 } as never);
    await screen.findByRole('button', { name: 'Refresh “Closed story”' });
  });

  it('refresh re-extracts through the background', async () => {
    const r = await withPins();
    extract.mockResolvedValue(ready('Fresh'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh “Dashboard”' }));
    await waitFor(() => {
      expect(pinRow('Dashboard').dataset.status).toBe('ready');
    });
    expect(requests.at(-1)?.type).toBe('refresh-pin');
    const [, pin] = await r.listPins(await activeSessionId());
    expect(pin?.text).toBe('Fresh');
  });

  it('open focuses an open tab or opens the URL in a new tab', async () => {
    await withPins();
    const update = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never);
    const focus = vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    fireEvent.click(screen.getByRole('button', { name: 'Open “Dashboard”' }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(DASHBOARD.id, { active: true });
    });
    expect(focus).toHaveBeenCalledWith(1, { focused: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open “Closed story”' }));
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({ url: 'https://closed.example/story#part' });
    });
  });

  it('unpin removes the pin, tells other sidebars and refocuses the section', async () => {
    const r = await withPins();
    fireEvent.click(screen.getByRole('button', { name: 'Unpin “Closed story”' }));
    await heading(2);
    const id = await activeSessionId();
    expect((await r.listPins(id)).map((p) => p.title)).toEqual(['Dashboard']);
    await waitFor(() => {
      expect(fromSidebar).toEqual([{ type: 'pins-changed', sessionId: id }]);
    });
    expect(document.activeElement?.className).toContain('session-tabs-toggle');
  });
});

describe('pinned current tab', () => {
  it('appears once, as a pinned row with the marker; unpinning brings back the needle', async () => {
    const r = await open();
    const id = await activeSessionId();
    await r.addPin(id, {
      url: `${ARTICLE.url}#comments`,
      title: 'Night trains return',
      kind: 'page',
    });
    await fromBackground({ type: 'pins-changed', sessionId: id });
    await screen.findByRole('button', { name: 'Unpin “Night trains return”' });
    await heading(1);
    expect(rows()).toHaveLength(1);
    const row = pinRow('Night trains return');
    expect(row.dataset.current).toBe('');
    expect(row.textContent).toContain('Current tab');
    expect(screen.queryByRole('button', { name: 'Pin to session' })).toBeNull();
    expect(screen.queryByRole('button', { name: /questions/ })).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'Unpin “Night trains return”' }));
    await screen.findByRole('button', { name: 'Pin to session' });
    await heading(1);
  });
});

describe('already pinned', () => {
  it('shows the notice with Refresh for a duplicate from the context menu, and dismisses', async () => {
    const r = await open();
    const id = await activeSessionId();
    const pin = await r.addPin(id, {
      url: ARTICLE.url,
      title: 'Night trains return',
      kind: 'page',
    });
    await fromBackground({ type: 'already-pinned', sessionId: id, pinId: pin.id });
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain('Already pinned');
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(requests).toEqual([{ type: 'refresh-pin', pinId: pin.id }]);
    });
    expect(screen.queryByText('Already pinned')).toBeNull();

    await fromBackground({ type: 'already-pinned', sessionId: id, pinId: pin.id });
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Already pinned')).toBeNull();
  });

  it('shows the notice when it was announced while the sidebar was still opening (D17)', async () => {
    const r = await freshRepository();
    repo = r;
    perms = fakePermissions([...NATIVE_HOSTS, '<all_urls>']);
    fakeBrowserModel();
    const session = await r.createSession({ providerId: null, model: null });
    await updateSettings({ activeSessionId: session.id });
    const pin = await r.addPin(session.id, {
      url: ARTICLE.url,
      title: 'Night trains return',
      kind: 'page',
    });
    let finishOpening: (opened: Repository) => void = () => undefined;
    const opening = new Promise<Repository>((resolve) => {
      finishOpening = resolve;
    });
    render(<App repository={opening} />);
    // The context-menu click opened the sidebar; its storage isn't open yet.
    await fromBackground({ type: 'already-pinned', sessionId: session.id, pinId: pin.id });
    finishOpening(r);
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toContain('Already pinned');
  });

  it('ignores notices and changes for another session', async () => {
    const r = await open();
    const other = await r.createSession({ providerId: null, model: null });
    const pin = await r.addPin(other.id, { url: ARTICLE.url, title: 'Elsewhere', kind: 'page' });
    await fromBackground({ type: 'already-pinned', sessionId: other.id, pinId: pin.id });
    await fromBackground({ type: 'pins-changed', sessionId: other.id });
    await heading(1);
    expect(screen.queryByText('Already pinned')).toBeNull();
    expect(screen.queryByText('Elsewhere')).toBeNull();
  });
});

describe('live updates', () => {
  it('a context-menu pin appears with its status changes while the sidebar is open', async () => {
    const r = await open();
    const id = await activeSessionId();
    const pin = await r.addPin(id, {
      url: 'https://menu.example/a',
      title: 'From the menu',
      kind: 'page',
    });
    await r.setSessionTitle(id, 'From the menu', 'fallback');
    await fromBackground({ type: 'pins-changed', sessionId: id });
    await waitFor(() => {
      expect(pinRow('From the menu').dataset.status).toBe('extracting');
    });
    await waitFor(() => {
      expect(titleButton().textContent).toBe('From the menu');
    });
    await r.updatePin(pin.id, { status: 'ready', text: 'x' });
    await fromBackground({ type: 'pins-changed', sessionId: id });
    await waitFor(() => {
      expect(pinRow('From the menu').dataset.status).toBe('ready');
    });
  });

  it('ignores foreign messages', async () => {
    await open();
    await heading(1);
    await deliver({ type: 'pins-changed' });
    await deliver('hello');
    await heading(1);
  });
});

describe('collapse', () => {
  it('hides the rows and remembers the state', async () => {
    await open();
    const toggle = await heading(1);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('session-tabs-body')?.hidden).toBe(true);
    await waitFor(async () => {
      expect((await getSettings()).sessionTabsExpanded).toBe(false);
    });
  });
});

describe('German', () => {
  it('renders the row actions in German', async () => {
    repo = await freshRepository('de');
    perms = fakePermissions([...NATIVE_HOSTS, '<all_urls>']);
    fakeBrowserModel();
    render(<App repository={Promise.resolve(repo)} />);
    expect(await screen.findByRole('button', { name: 'An Sitzung anheften' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aus Fragen ausschließen' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Sitzungs-Tabs' })).toBeTruthy();
  });
});

describe('rows (redesign spec 5.2)', () => {
  const meta = (row: HTMLElement) => row.querySelector('.tab-row-meta')?.textContent;
  const number = (row: HTMLElement) => row.querySelector('.citation-number')?.textContent ?? null;

  /** Pins of each type and status, in this order. */
  async function withAllStates(): Promise<Repository> {
    const r = await open();
    const id = await activeSessionId();
    const a = await r.addPin(id, { url: 'https://a.example/x', title: 'Alpha', kind: 'page' });
    await r.updatePin(a.id, { status: 'ready', text: 'a', truncated: true });
    await r.addPin(id, {
      url: 'https://www.youtube.com/watch?v=1',
      title: 'Video',
      kind: 'youtube',
    });
    const c = await r.addPin(id, { url: 'https://c.example/doc.pdf', title: 'Doc', kind: 'pdf' });
    await r.updatePin(c.id, { status: 'failed', failureReason: 'empty' });
    await fromBackground({ type: 'pins-changed', sessionId: id });
    await heading(4);
    return r;
  }

  it('names the toggle with the label and the count, shown in a pill', async () => {
    await withAllStates();
    const toggle = await heading(4);
    expect(toggle.querySelector('.session-tabs-label')?.textContent).toBe('Session tabs');
    expect(toggle.querySelector('.count-pill')?.textContent).toBe('4');
  });

  it('show the citation number, host, type and status of each pin', async () => {
    await withAllStates();
    const [alpha, video, doc, current] = rows() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(number(alpha)).toBe('1');
    expect(meta(alpha)).toBe('1a.example·Page·Truncated');
    expect(alpha.querySelector('.pin-truncated')?.textContent).toBe('Truncated');
    // Ready: a dot with a hidden "Ready".
    expect(alpha.querySelector('.status-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(alpha.querySelector('.pin-status .visually-hidden')?.textContent).toBe('Ready');

    expect(meta(video)).toBe('2www.youtube.com·YouTube');
    expect(video.querySelector('.pin-status-extracting')?.textContent).toBe('Extracting…');
    expect(video.querySelector('.spinner svg')).toBeTruthy();

    expect(meta(doc)).toBe('3c.example·PDF');
    expect(doc.querySelector('.pin-status-failed')?.textContent).toBe('Failed');
    expect(doc.querySelector('.tab-row-error')?.textContent).toBe(
      readMessages('en').extractFailedEmpty?.message,
    );

    // The unpinned current tab is cited after every pin, ready or not.
    expect(number(current)).toBe('4');
    expect(meta(current)).toBe('4Current tab·news.example');
    expect(current.querySelector('.tab-row-current')?.textContent).toBe('Current tab');
    // Separators are decoration.
    for (const sep of document.querySelectorAll('.meta-separator')) {
      expect(sep.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('use a fallback icon by type when there is no favicon', async () => {
    await withAllStates();
    const kinds = rows().map((row) =>
      row.querySelector('.tab-tile-fallback')?.getAttribute('data-fallback'),
    );
    expect(kinds).toEqual(['page', 'youtube', 'pdf', 'page']);
  });

  it('keep every action of a pin row in the DOM and in the tab order beside the status', async () => {
    await withAllStates();
    const [alpha] = rows() as [HTMLElement];
    const actions = alpha.querySelector('.tab-row-actions') as HTMLElement;
    const buttons = within(actions).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open “Alpha”',
      'Unpin “Alpha”',
    ]);
    for (const button of buttons) {
      expect(button.tabIndex).toBe(0);
      expect(button.hidden).toBe(false);
    }
    expect(alpha.querySelector('.pin-status')).toBeTruthy();
    // The unpin needle is the filled one.
    expect(within(actions).getByRole('button', { name: 'Unpin “Alpha”' }).className).toContain(
      'unpin-button',
    );
  });

  it('give the current-tab row a Pin text button named “Pin to session”', async () => {
    await open();
    await heading(1);
    const row = currentRow() as HTMLElement;
    expect(row.className).toContain('current-row');
    const pinButton = within(row).getByRole('button', { name: 'Pin to session' });
    expect(pinButton.textContent).toBe('Pin');
    expect(pinButton.querySelector('svg')).toBeTruthy();
    expect(number(row)).toBe('1');
  });

  it('show no number on an excluded current tab', async () => {
    await open();
    await heading(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Exclude from questions' }));
    await screen.findByRole('button', { name: 'Include in questions' });
    const row = currentRow() as HTMLElement;
    expect(number(row)).toBeNull();
    expect(meta(row)).toBe('Current tab·news.example·Not included in questions');
  });

  it('number a pinned current tab as its pin, with no separate current-tab row', async () => {
    const r = await open();
    const id = await activeSessionId();
    await r.addPin(id, { url: DASHBOARD.url, title: 'Dashboard', kind: 'page' });
    await r.addPin(id, { url: ARTICLE.url, title: 'Night trains return', kind: 'page' });
    await fromBackground({ type: 'pins-changed', sessionId: id });
    await heading(2);
    const list = rows();
    expect(list.map(number)).toEqual(['1', '2']);
    expect(meta(list[1] as HTMLElement)).toBe('2news.example·Page·Current tab');
    expect(document.querySelector('.current-row')).toBeNull();
  });

  it.each([
    ['not accessible', [...NATIVE_HOSTS], 'noAccess'],
    ['restricted', [...NATIVE_HOSTS, '<all_urls>'], 'restricted'],
  ])(
    'show an unreadable tab (%s) with the globe tile and no number',
    async (_name, granted, state) => {
      if (state === 'restricted') tabs = [{ ...ARTICLE, url: 'chrome://settings/' }];
      await open(granted);
      await waitFor(() => {
        expect(currentRow()?.dataset.state).toBe(state);
      });
      const row = currentRow() as HTMLElement;
      expect(row.className).toContain('tab-row-unavailable');
      expect(row.querySelector('.tab-tile-fallback')?.getAttribute('data-fallback')).toBe('page');
      expect(number(row)).toBeNull();
      if (state === 'noAccess') {
        expect(within(row).getByRole('button', { name: 'Allow on all sites' })).toBeTruthy();
      } else {
        // The browser hides the title of a page the extension can't read.
        expect(meta(row)).toBe('Current tab');
      }
    },
  );
});

describe('German labels', () => {
  it('show the section label and the Pin text in German', async () => {
    repo = await freshRepository('de');
    perms = fakePermissions([...NATIVE_HOSTS, '<all_urls>']);
    fakeBrowserModel();
    render(<App repository={Promise.resolve(repo)} />);
    const pin = await screen.findByRole('button', { name: 'An Sitzung anheften' });
    expect(pin.textContent).toBe('Anheften');
    expect(screen.getByRole('button', { name: 'Sitzungs-Tabs 1' })).toBeTruthy();
  });
});
