import { describe, expect, it } from 'vitest';
import { isRestrictedUrl, sitePattern } from '@/shared/restricted';

// Spec 5.3: browser-internal pages, web stores, other extensions' pages,
// `view-source:` and `file://` can't be read.
const TABLE: [url: string, chrome: boolean, firefox: boolean][] = [
  ['https://example.com/article', false, false],
  ['http://127.0.0.1:8080/page.html', false, false],
  ['https://en.wikipedia.org/wiki/Pin', false, false],
  ['https://www.youtube.com/watch?v=abc', false, false],
  ['https://example.com/report.pdf', false, false],
  // Browser-internal pages.
  ['chrome://settings/', true, true],
  ['chrome://newtab/', true, true],
  ['chrome-search://local-ntp/local-ntp.html', true, true],
  ['chrome-untrusted://print/', true, true],
  ['devtools://devtools/bundled/inspector.html', true, true],
  ['edge://extensions/', true, true],
  ['about:blank', true, true],
  ['about:newtab', true, true],
  ['about:addons', true, true],
  ['about:debugging#/runtime/this-firefox', true, true],
  ['resource://pdf.js/web/viewer.html', true, true],
  // Other extensions' pages.
  ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html', true, true],
  ['moz-extension://3f0d6c2e-1b1a-4c7b-9d0e-0a1b2c3d4e5f/page.html', true, true],
  // view-source:, file:// and other non-web schemes.
  ['view-source:https://example.com/', true, true],
  ['file:///home/user/notes.html', true, true],
  ['file:///C:/Users/me/report.pdf', true, true],
  ['data:text/html,<p>hi</p>', true, true],
  ['blob:https://example.com/5f1c', true, true],
  ['javascript:void(0)', true, true],
  ['ftp://ftp.example.com/', true, true],
  // Web stores: each browser blocks scripts on its own store.
  ['https://chromewebstore.google.com/detail/abc', true, false],
  ['https://chrome.google.com/webstore/detail/abc', true, false],
  ['https://chrome.google.com/search?q=webstore', false, false],
  ['https://microsoftedge.microsoft.com/addons/detail/abc', true, false],
  ['https://addons.mozilla.org/en-US/firefox/addon/abc/', false, true],
  ['https://accounts.firefox.com/settings', false, true],
  ['https://support.mozilla.org/en-US/', false, true],
  ['https://www.mozilla.org/en-US/', false, false],
  // Not a URL at all.
  ['', true, true],
  ['not a url', true, true],
];

describe('isRestrictedUrl', () => {
  it.each(TABLE)('%s: chrome %s, firefox %s', (url, chrome, firefox) => {
    expect(isRestrictedUrl(url, 'chrome')).toBe(chrome);
    expect(isRestrictedUrl(url, 'firefox')).toBe(firefox);
  });

  it('ignores letter case in the host', () => {
    expect(isRestrictedUrl('https://ChromeWebStore.Google.com/', 'chrome')).toBe(true);
    expect(isRestrictedUrl('https://ADDONS.mozilla.org/', 'firefox')).toBe(true);
  });
});

describe('sitePattern', () => {
  it.each([
    ['https://example.com/a/b?c=d#e', 'https://example.com/*'],
    ['http://127.0.0.1:8080/page.html', 'http://127.0.0.1/*'],
    ['https://sub.example.co.uk/', 'https://sub.example.co.uk/*'],
  ])('%s -> %s', (url, pattern) => {
    expect(sitePattern(url)).toBe(pattern);
  });

  it('has no pattern for restricted or invalid URLs', () => {
    expect(sitePattern('chrome://settings/')).toBeNull();
    expect(sitePattern('file:///tmp/a.html')).toBeNull();
    expect(sitePattern('nope')).toBeNull();
  });
});
