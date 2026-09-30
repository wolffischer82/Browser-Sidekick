import { browser } from 'wxt/browser';

/** Firefox-only API; not part of the Chrome typings WXT ships. */
interface FirefoxSidebarAction {
  toggle(): Promise<void>;
}

/**
 * Makes the toolbar icon open and close the sidebar (spec 5.1).
 * Chrome: the side panel behaviour handles the click itself.
 * Firefox: `sidebarAction.toggle()` must run synchronously inside the click
 * handler, since it needs the user-action context.
 */
export function toggleSidebarOnActionClick(isFirefox: boolean): void {
  if (isFirefox) {
    const sidebarAction = (browser as unknown as { sidebarAction: FirefoxSidebarAction })
      .sidebarAction;
    browser.action.onClicked.addListener(() => {
      void sidebarAction.toggle();
    });
    return;
  }
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    console.error('Browser Sidekick: could not set the side panel behaviour.');
  });
}
