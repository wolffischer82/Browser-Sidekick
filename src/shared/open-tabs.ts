import { browser } from 'wxt/browser';
import { normalizePinUrl } from './pins';
import { watchHostAccess } from './provider-access';

/**
 * Open tabs by URL, for Refresh (D3), Open (spec 5.2) and later citations
 * (D13). Without the `tabs` permission the browser shows a tab's URL only
 * with host access to its site, so a pinned page counts as open when its
 * tab is visible with the same URL (fragment ignored). Nothing is logged.
 */

export interface OpenTab {
  tabId: number;
  windowId: number;
  url: string;
  active: boolean;
}

/** Every tab whose URL the extension can see. Never throws. */
export async function listOpenTabs(): Promise<OpenTab[]> {
  try {
    const tabs = await browser.tabs.query({});
    return tabs.flatMap((tab) =>
      tab.id !== undefined && tab.url
        ? [{ tabId: tab.id, windowId: tab.windowId, url: tab.url, active: tab.active }]
        : [],
    );
  } catch {
    return [];
  }
}

/** The open tab showing `url` (fragment ignored); an active tab wins. */
export function findTab(tabs: readonly OpenTab[], url: string): OpenTab | undefined {
  const target = normalizePinUrl(url);
  const matches = tabs.filter((tab) => normalizePinUrl(tab.url) === target);
  return matches.find((tab) => tab.active) ?? matches[0];
}

export async function findOpenTab(url: string): Promise<OpenTab | undefined> {
  return findTab(await listOpenTabs(), url);
}

/**
 * Focuses the tab showing `url` and its window, or opens `url` in a new tab
 * (spec 5.2 "open", D13). Only http(s) URLs are opened.
 */
export async function focusOrOpen(url: string): Promise<void> {
  const tab = await findOpenTab(url);
  if (tab) {
    await browser.tabs.update(tab.tabId, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
    return;
  }
  if (/^https?:/i.test(url)) await browser.tabs.create({ url });
}

/**
 * Calls `listener` with the open tabs now and whenever a tab opens, closes
 * or changes URL, or host access changes. Returns a function that stops.
 */
export function watchOpenTabs(listener: (tabs: OpenTab[]) => void): () => void {
  let stopped = false;
  let generation = 0;
  const refresh = () => {
    const mine = ++generation;
    void listOpenTabs().then((tabs) => {
      // Only the latest read counts.
      if (!stopped && mine === generation) listener(tabs);
    });
  };
  const onUpdated = (_tabId: number, change: { url?: string; status?: string }) => {
    if (change.url !== undefined || change.status === 'complete') refresh();
  };
  browser.tabs.onCreated.addListener(refresh);
  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(refresh);
  browser.tabs.onActivated.addListener(refresh);
  const unwatchAccess = watchHostAccess(refresh);
  refresh();
  return () => {
    stopped = true;
    browser.tabs.onCreated.removeListener(refresh);
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onRemoved.removeListener(refresh);
    browser.tabs.onActivated.removeListener(refresh);
    unwatchAccess();
  };
}
