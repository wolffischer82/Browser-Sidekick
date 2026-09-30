import { browser } from 'wxt/browser';
import { ALL_SITES } from './page-access';
import { hasHostAccess, watchHostAccess } from './provider-access';
import { CURRENT_BROWSER, isRestrictedUrl, sitePattern, type BrowserName } from './restricted';

/**
 * The current tab (spec 5.2 item 3, 5.3): the active tab of the last focused
 * browser window. There is no `tabs` permission, so a tab's URL and title are
 * only visible with host access to its site (the all-sites grant, a site
 * grant, or `activeTab` after a toolbar or context-menu click). A tab whose
 * URL is hidden is "not accessible". Nothing here logs or sends URLs.
 */
export type CurrentTab =
  | { state: 'none' }
  | {
      state: 'readable';
      tabId: number;
      windowId: number;
      url: string;
      title: string;
      faviconUrl: string | null;
      /**
       * A lasting grant covers the site. `false` means access comes from
       * `activeTab` only, so pinning asks for the site (D10).
       */
      siteAccess: boolean;
    }
  | {
      state: 'restricted';
      tabId: number;
      windowId: number;
      url: string | null;
      title: string | null;
    }
  | { state: 'noAccess'; tabId: number; windowId: number };

export interface TabInfo {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

/**
 * Classifies a tab from what the browser revealed. With the all-sites grant
 * every web page's URL is visible, so a hidden URL means a browser-internal
 * or other restricted page; without it, the page is simply not accessible.
 */
export function classifyTab(
  tab: TabInfo | undefined,
  access: { allSites: boolean; site: boolean },
  browserName: BrowserName = CURRENT_BROWSER,
): CurrentTab {
  if (tab?.id === undefined || tab.windowId === undefined) return { state: 'none' };
  const ids = { tabId: tab.id, windowId: tab.windowId };
  const url = tab.url ?? '';
  if (url === '') {
    return access.allSites
      ? { state: 'restricted', ...ids, url: null, title: tab.title ?? null }
      : { state: 'noAccess', ...ids };
  }
  if (isRestrictedUrl(url, browserName)) {
    return { state: 'restricted', ...ids, url, title: tab.title ?? null };
  }
  return {
    state: 'readable',
    ...ids,
    url,
    title: tab.title ?? url,
    faviconUrl: tab.favIconUrl ?? null,
    siteAccess: access.allSites || access.site,
  };
}

async function activeTab(): Promise<TabInfo | undefined> {
  // Popups and devtools windows are skipped, so the sidebar follows the
  // browser window the user last worked in.
  const win = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
  if (win.id === undefined) return undefined;
  const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
  return tab;
}

/** Reads the current tab once. Never throws. */
export async function readCurrentTab(): Promise<CurrentTab> {
  try {
    const tab = await activeTab();
    const pattern = tab?.url ? sitePattern(tab.url) : null;
    const [allSites, site] = await Promise.all([
      hasHostAccess(ALL_SITES),
      pattern ? hasHostAccess(pattern) : Promise.resolve(false),
    ]);
    return classifyTab(tab, { allSites, site });
  } catch {
    return { state: 'none' };
  }
}

function same(a: CurrentTab, b: CurrentTab): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Calls `listener` with the current tab now and whenever it changes: tab
 * activation, navigation or title change of the current tab, window focus,
 * and host permission changes. Returns a function that stops watching.
 */
export function watchCurrentTab(listener: (tab: CurrentTab) => void): () => void {
  let stopped = false;
  let last: CurrentTab | null = null;
  // One read at a time; an event during a read makes it read again, and
  // only the result of a read with no event during it is reported.
  let reading = false;
  let dirty = false;
  const refresh = () => {
    if (reading) {
      dirty = true;
      return;
    }
    reading = true;
    void readCurrentTab().then((tab) => {
      reading = false;
      if (stopped) return;
      if (dirty) {
        dirty = false;
        refresh();
        return;
      }
      if (last && same(last, tab)) return;
      last = tab;
      listener(tab);
    });
  };
  // While a read runs, the tab it will find isn't known yet, so any update counts.
  const onUpdated = (tabId: number) => {
    if (reading || !last || last.state === 'none' || last.tabId === tabId) refresh();
  };
  const onFocus = (windowId: number) => {
    // WINDOW_ID_NONE (-1): focus left the browser; keep the last tab.
    if (windowId !== -1) refresh();
  };
  browser.tabs.onActivated.addListener(refresh);
  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(refresh);
  browser.windows.onFocusChanged.addListener(onFocus);
  const unwatchAccess = watchHostAccess(refresh);
  refresh();
  return () => {
    stopped = true;
    browser.tabs.onActivated.removeListener(refresh);
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onRemoved.removeListener(refresh);
    browser.windows.onFocusChanged.removeListener(onFocus);
    unwatchAccess();
  };
}
