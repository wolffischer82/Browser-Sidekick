/**
 * Pages the extension can't read (spec 5.3): browser-internal pages, web
 * stores, other extensions' pages, `view-source:` and `file://`. Only
 * `http:` and `https:` pages can be read at all; on top of that each browser
 * blocks extensions from its own store and a few of its own sites.
 */

export type BrowserName = 'chrome' | 'firefox';

/** The browser this build runs in. */
export const CURRENT_BROWSER: BrowserName = import.meta.env.FIREFOX ? 'firefox' : 'chrome';

/** Hosts where Chrome refuses script injection (the Chrome and Edge web stores). */
const CHROME_BLOCKED: { host: string; path?: string }[] = [
  { host: 'chromewebstore.google.com' },
  { host: 'chrome.google.com', path: '/webstore' },
  { host: 'microsoftedge.microsoft.com', path: '/addons' },
];

/**
 * Firefox's `extensions.webextensions.restrictedDomains` default: add-ons
 * site and Mozilla account/support hosts.
 */
const FIREFOX_BLOCKED = new Set([
  'accounts-static.cdn.mozilla.net',
  'accounts.firefox.com',
  'addons.cdn.mozilla.net',
  'addons.mozilla.org',
  'api.accounts.firefox.com',
  'content.cdn.mozilla.net',
  'discovery.addons.mozilla.org',
  'install.mozilla.org',
  'oauth.accounts.firefox.com',
  'profile.accounts.firefox.com',
  'support.mozilla.org',
  'sync.services.mozilla.com',
]);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isWeb(parsed: URL): boolean {
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/** Whether the page at `url` can never be read in `browser`. */
export function isRestrictedUrl(url: string, browser: BrowserName = CURRENT_BROWSER): boolean {
  const parsed = parse(url);
  if (!parsed || !isWeb(parsed)) return true;
  const host = parsed.hostname.toLowerCase();
  if (browser === 'firefox') return FIREFOX_BLOCKED.has(host);
  return CHROME_BLOCKED.some(
    (b) =>
      b.host === host &&
      (b.path === undefined ||
        parsed.pathname === b.path ||
        parsed.pathname.startsWith(`${b.path}/`)),
  );
}

/**
 * The host permission pattern for one site (D10): scheme and host, any path.
 * No port, because Firefox match patterns can't carry one and Chrome's
 * portless pattern covers every port. `null` for non-web URLs.
 */
export function sitePattern(url: string): string | null {
  const parsed = parse(url);
  if (!parsed || !isWeb(parsed)) return null;
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
