import { browser, type Browser } from 'wxt/browser';
import { openRepository, type Repository } from './db/repository';
import { extractTab } from './extract';
import { t } from './i18n';
import {
  broadcast,
  broadcastWhenHeard,
  isSidekickMessage,
  type PinOutcome,
  type SidekickBroadcast,
  type SidekickRequest,
} from './messages';
import { findOpenTab } from './open-tabs';
import { startPin, startRefresh, type PageRef, type PinDeps, type PinStart } from './pins';
import { openActiveSession } from './sessions';
import { openSidebarInUserAction } from './sidebar-toggle';

/**
 * The background's pinning service (spec 5.4, 6 "Contexts"): the "Pin to
 * Sidekick" context menu and the sidebar's pin and refresh requests. Pins go
 * through `pins.ts`, which broadcasts every change to open sidebars.
 */

export const PIN_MENU_ID = 'sidekick-pin';

type MenuContexts = NonNullable<Browser.contextMenus.CreateProperties['contexts']>;

/**
 * Chrome: `page` and `frame`. Firefox also `tab` (the tab strip); its
 * `contextMenus` namespace imports the whole `menus` schema, so `tab` needs
 * no `menus` permission (decisions.md T07).
 */
export function pinMenuContexts(isFirefox: boolean): MenuContexts {
  return isFirefox ? ['page', 'frame', 'tab'] : ['page', 'frame'];
}

/** Creates the menu item. Menu items persist, so this runs on install and update. */
export async function registerPinMenu(isFirefox: boolean): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: PIN_MENU_ID,
    title: t('contextMenuPin'),
    contexts: pinMenuContexts(isFirefox),
  });
}

/** What the browser shows about a tab; `null` when its URL is hidden. */
export function pageRef(tab: Browser.tabs.Tab | undefined, fallbackUrl?: string): PageRef | null {
  const url = tab?.url ?? fallbackUrl;
  if (tab?.id === undefined || !url) return null;
  return { tabId: tab.id, url, title: tab.title ?? '', faviconUrl: tab.favIconUrl ?? null };
}

/** Lets the background open its repository once, on first use (decisions.md T03-1). */
export function lazyRepository(): () => Promise<Repository> {
  let opened: Promise<Repository> | null = null;
  return () => {
    opened ??= openRepository().catch((error: unknown) => {
      opened = null;
      throw error;
    });
    return opened;
  };
}

export interface ServiceDeps extends Omit<PinDeps, 'repo'> {
  repo: () => Promise<Repository>;
  /** Opens the sidebar of that window; defaults to the browser's own call (D17). */
  openSidebar?: (windowId: number | undefined) => void;
  /**
   * Announces a menu click's "Already pinned" to a sidebar that may only
   * just be opening (D17); defaults to `broadcast`.
   */
  announce?: (message: SidekickBroadcast) => Promise<unknown>;
}

export function defaultServiceDeps(): ServiceDeps {
  return { repo: lazyRepository(), extract: extractTab, broadcast, announce: broadcastWhenHeard };
}

async function pinDeps(deps: ServiceDeps): Promise<PinDeps> {
  return { ...deps, repo: await deps.repo() };
}

/**
 * The menu click (spec 5.4): pins the clicked page into the active session,
 * creating one if needed, whether or not a sidebar is open (the listener in
 * `startPinService` opens it, D17). The click grants
 * `activeTab` for that tab, so its URL is visible and it can be read. A
 * duplicate is announced to open sidebars, which show "Already pinned".
 */
export async function handleMenuClick(
  deps: ServiceDeps,
  info: { menuItemId: string | number; pageUrl?: string },
  tab: Browser.tabs.Tab | undefined,
): Promise<PinStart | null> {
  if (info.menuItemId !== PIN_MENU_ID) return null;
  const page = pageRef(tab, info.pageUrl);
  if (!page) return null;
  const pins = await pinDeps(deps);
  const session = await openActiveSession(pins.repo);
  const start = await startPin(pins, session.id, page);
  if (start.status === 'duplicate') {
    const announce = deps.announce ?? deps.broadcast;
    await announce({ type: 'already-pinned', sessionId: session.id, pinId: start.pin.id });
  }
  return start;
}

/**
 * A sidebar request. Answers once the pin is stored as `extracting`;
 * extraction continues and its result arrives as a `pins-changed` broadcast.
 */
export async function handleRequest(
  deps: ServiceDeps,
  message: SidekickRequest,
): Promise<PinOutcome> {
  const pins = await pinDeps(deps);
  if (message.type === 'pin-tab') {
    let tab: Browser.tabs.Tab | undefined;
    try {
      tab = await browser.tabs.get(message.tabId);
    } catch {
      return { status: 'refused', reason: 'not-open' };
    }
    const page = pageRef(tab);
    if (!page) return { status: 'refused', reason: 'no-access' };
    const start = await startPin(pins, message.sessionId, page);
    return start.status === 'refused' ? start : { status: start.status, pinId: start.pin.id };
  }
  const pin = await pins.repo.getPin(message.pinId);
  if (!pin) return { status: 'refused', reason: 'not-found' };
  const open = await findOpenTab(pin.url);
  if (!open) return { status: 'refused', reason: 'not-open' };
  const tab = await browser.tabs.get(open.tabId).catch(() => undefined);
  const page = pageRef(tab) ?? { tabId: open.tabId, url: open.url, title: '', faviconUrl: null };
  const start = await startRefresh(pins, pin.id, page);
  return start.status === 'refused' ? start : { status: 'refreshing', pinId: start.pin.id };
}

/**
 * The `runtime.onMessage` listener. Only requests are answered; broadcasts
 * from sidebars are left alone (returning `false` keeps no channel open).
 */
export function onRequestMessage(
  deps: ServiceDeps,
  message: unknown,
  sendResponse: (response: PinOutcome) => void,
): boolean {
  if (!isSidekickMessage(message)) return false;
  if (message.type !== 'pin-tab' && message.type !== 'refresh-pin') return false;
  handleRequest(deps, message).then(sendResponse, () => {
    console.error('Sidekick: a pin request failed.');
    sendResponse({ status: 'refused', reason: 'not-found' });
  });
  return true;
}

/** Wires the menu and the request listener; called from the background entrypoint. */
export function startPinService(isFirefox: boolean, deps = defaultServiceDeps()): void {
  browser.runtime.onInstalled.addListener(() => {
    registerPinMenu(isFirefox).catch(() => {
      console.error('Sidekick: the context menu could not be created.');
    });
  });
  const openSidebar =
    deps.openSidebar ??
    ((windowId: number | undefined) => {
      openSidebarInUserAction(isFirefox, windowId);
    });
  browser.contextMenus.onClicked.addListener((info, tab) => {
    // D17: the click also opens the sidebar, so the pin or its message is
    // visible. This has to be the first thing in the handler, before any
    // `await`: the browsers only allow it while the click is being handled.
    if (info.menuItemId === PIN_MENU_ID) openSidebar(tab?.windowId);
    handleMenuClick(deps, info, tab).catch(() => {
      console.error('Sidekick: a page could not be pinned.');
    });
  });
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) =>
    onRequestMessage(deps, message, sendResponse),
  );
}
