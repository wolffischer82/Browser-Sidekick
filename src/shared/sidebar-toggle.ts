import { browser } from 'wxt/browser';

/** Firefox-only API; not part of the Chrome typings WXT ships. */
interface FirefoxSidebarAction {
  toggle(): Promise<void>;
  open(): Promise<void>;
}

function firefoxSidebar(): FirefoxSidebarAction {
  return (browser as unknown as { sidebarAction: FirefoxSidebarAction }).sidebarAction;
}

/**
 * Makes the toolbar icon open and close the sidebar (spec 5.1).
 * Chrome: the side panel behaviour handles the click itself.
 * Firefox: `sidebarAction.toggle()` must run synchronously inside the click
 * handler, since it needs the user-action context.
 */
export function toggleSidebarOnActionClick(isFirefox: boolean): void {
  if (isFirefox) {
    const sidebarAction = firefoxSidebar();
    browser.action.onClicked.addListener(() => {
      void sidebarAction.toggle();
    });
    return;
  }
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    console.error('Browser Sidekick: could not set the side panel behaviour.');
  });
}

/**
 * Opens the sidebar from a user action, e.g. the context-menu click (D17,
 * spec 5.4). Both browsers allow this only while the click is being
 * handled, so it must be called synchronously in the handler, before any
 * `await`. Chrome: `sidePanel.open({ windowId })` (Chrome 116, the minimum
 * version; covered by the `sidePanel` permission). Firefox:
 * `sidebarAction.open()` (no permission). An open sidebar stays as it is.
 * Never throws: if the browser refuses, the pin still goes ahead.
 */
export function openSidebarInUserAction(isFirefox: boolean, windowId: number | undefined): void {
  try {
    if (isFirefox) {
      firefoxSidebar()
        .open()
        .catch(() => undefined);
      return;
    }
    if (windowId === undefined || windowId < 0) return;
    browser.sidePanel.open({ windowId }).catch(() => undefined);
  } catch {
    // The browser has no such call or refused it; pinning doesn't depend on it.
  }
}
