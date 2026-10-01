import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  ALL_SITES,
  hasAllSitesAccess,
  hasSiteAccess,
  requestAllSitesAccess,
  requestSiteAccess,
} from '@/shared/page-access';
import { fakePermissions, type FakePermissions } from './helpers/permissions';

let perms: FakePermissions;

beforeEach(() => {
  fakeBrowser.reset();
  perms = fakePermissions([]);
});

describe('all sites (spec 5.3)', () => {
  it('checks and requests <all_urls>', async () => {
    expect(await hasAllSitesAccess()).toBe(false);
    const pending = requestAllSitesAccess();
    // The request reaches the browser synchronously, inside the click.
    expect(perms.requests).toEqual([[ALL_SITES]]);
    expect(await pending).toBe(true);
    expect(await hasAllSitesAccess()).toBe(true);
  });

  it('resolves false when declined or refused', async () => {
    perms.answer = 'decline';
    expect(await requestAllSitesAccess()).toBe(false);
    perms.answer = 'throw';
    expect(await requestAllSitesAccess()).toBe(false);
  });
});

describe('one site (D10)', () => {
  it('requests the scheme and host of the URL', async () => {
    expect(await hasSiteAccess('http://127.0.0.1:8080/page.html')).toBe(false);
    const pending = requestSiteAccess('http://127.0.0.1:8080/page.html?q=1#x');
    expect(perms.requests).toEqual([['http://127.0.0.1/*']]);
    expect(await pending).toBe(true);
    expect(await hasSiteAccess('http://127.0.0.1:9090/other')).toBe(true);
    expect(await hasSiteAccess('https://127.0.0.1/other')).toBe(false);
  });

  it('is covered by the all-sites grant', async () => {
    perms.granted.add(ALL_SITES);
    expect(await hasSiteAccess('https://example.com/')).toBe(true);
  });

  it('does not ask for non-web pages', async () => {
    expect(await requestSiteAccess('chrome://settings/')).toBe(false);
    expect(await requestSiteAccess('file:///tmp/a.html')).toBe(false);
    expect(await hasSiteAccess('about:blank')).toBe(false);
    expect(perms.requests).toEqual([]);
  });

  it('resolves false when declined', async () => {
    perms.answer = 'decline';
    expect(await requestSiteAccess('https://example.com/')).toBe(false);
  });
});
