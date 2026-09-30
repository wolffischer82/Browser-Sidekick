import { hasHostAccess, requestHostAccess } from './provider-access';
import { sitePattern } from './restricted';

/**
 * Access to web pages (spec 5.3, D2, D10). The manifest declares
 * `optional_host_permissions: ["<all_urls>"]`; the sidebar asks for it once
 * from the access banner, and pinning from the sidebar falls back to one
 * site. Both requests must start synchronously in the click handler, with no
 * `await` before them, because Firefox refuses them otherwise.
 */

export const ALL_SITES = '<all_urls>';

/** Whether the all-sites grant is held. */
export function hasAllSitesAccess(): Promise<boolean> {
  return hasHostAccess(ALL_SITES);
}

/** Asks for access to all sites (the banner's button). Call from the click. */
export function requestAllSitesAccess(): Promise<boolean> {
  return requestHostAccess(ALL_SITES);
}

/** Whether the extension holds a lasting grant for the site of `url`. */
export async function hasSiteAccess(url: string): Promise<boolean> {
  const pattern = sitePattern(url);
  return pattern ? hasHostAccess(pattern) : false;
}

/**
 * Asks for access to the site of `url` only (D10). Call from the click.
 * Resolves `false` for non-web URLs, when declined, or when the browser
 * refuses to ask.
 */
export function requestSiteAccess(url: string): Promise<boolean> {
  const pattern = sitePattern(url);
  return pattern ? requestHostAccess(pattern) : Promise.resolve(false);
}
