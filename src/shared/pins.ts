import type { Repository } from './db/repository';
import { detectKind, type ExtractionResult } from './extract';
import type { SidekickBroadcast } from './messages';
import type { Pin } from './model';
import { CURRENT_BROWSER, isRestrictedUrl, type BrowserName } from './restricted';

/**
 * Pin orchestration (spec 5.4, 5.5, D3, D11). Runs in the background: it adds
 * a pin with status `extracting`, runs the extractor dispatcher, then stores
 * the snapshot and sets `ready`, or sets `failed` with the reason code. Every
 * change is broadcast so open sidebars update live. Nothing is logged.
 */

export interface PinDeps {
  repo: Repository;
  extract: (tabId: number, url: string) => Promise<ExtractionResult>;
  broadcast: (message: SidekickBroadcast) => Promise<void>;
  now?: () => number;
  browser?: BrowserName;
}

/** The tab a pin is read from, as the browser shows it. */
export interface PageRef {
  tabId: number;
  url: string;
  /** May be empty; the URL stands in until the extractor finds a title. */
  title: string;
  faviconUrl: string | null;
}

export type PinStart =
  | { status: 'pinned'; pin: Pin; extraction: Promise<void> }
  | { status: 'duplicate'; pin: Pin }
  | { status: 'refused'; reason: 'restricted' | 'not-found' };

export type RefreshStart =
  | { status: 'refreshing'; pin: Pin; extraction: Promise<void> }
  | { status: 'refused'; reason: 'not-found' };

/**
 * The URL used to recognise the same page (spec 5.4): the fragment is
 * stripped and the URL serialised (lower-case host, root path). Unparsable
 * input only loses its fragment.
 */
export function normalizePinUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/#$/, '');
  } catch {
    const hash = url.indexOf('#');
    return hash === -1 ? url : url.slice(0, hash);
  }
}

/** The pin showing the same page as `url`, if any. */
export function findPinByUrl<T extends Pick<Pin, 'url'>>(
  pins: readonly T[],
  url: string,
): T | undefined {
  const target = normalizePinUrl(url);
  return pins.find((pin) => normalizePinUrl(pin.url) === target);
}

/**
 * Extracts `page` into `pin` and records the outcome. Never rejects: an
 * extractor error counts as `unreadable`, and a pin deleted meanwhile stays
 * deleted (`updatePin` ignores missing pins).
 */
async function runExtraction(deps: PinDeps, pin: Pin, page: PageRef): Promise<void> {
  const now = deps.now ?? Date.now;
  let result: ExtractionResult;
  try {
    result = await deps.extract(page.tabId, pin.url);
  } catch {
    result = { ok: false, kind: pin.kind, reason: 'unreadable' };
  }
  try {
    if (result.ok) {
      await deps.repo.updatePin(pin.id, {
        status: 'ready',
        kind: result.kind,
        text: result.text,
        truncated: result.truncated,
        extractedAt: now(),
        failureReason: null,
        // A tab without a title was pinned under its URL; the page's own title is better.
        ...(page.title === '' && result.title !== '' ? { title: result.title } : {}),
      });
    } else {
      // A failed refresh keeps the previous snapshot in storage; only
      // `ready` pins are sent as context (spec 5.6).
      await deps.repo.updatePin(pin.id, {
        status: 'failed',
        kind: result.kind,
        failureReason: result.reason,
      });
    }
  } catch {
    console.error('Sidekick: a pin could not be updated.');
  }
  await deps.broadcast({ type: 'pins-changed', sessionId: pin.sessionId });
}

/**
 * Pins `page` into session `sessionId` (spec 5.4). Resolves once the pin is
 * stored with status `extracting`; `extraction` resolves when it is `ready`
 * or `failed`. A page already pinned in the session (fragment ignored) is
 * not added again. Restricted pages can't be pinned (spec 5.3).
 */
export async function startPin(deps: PinDeps, sessionId: string, page: PageRef): Promise<PinStart> {
  if (isRestrictedUrl(page.url, deps.browser ?? CURRENT_BROWSER)) {
    return { status: 'refused', reason: 'restricted' };
  }
  const { repo } = deps;
  const session = await repo.getSession(sessionId);
  if (!session) return { status: 'refused', reason: 'not-found' };
  const existing = await repo.listPins(sessionId);
  const duplicate = findPinByUrl(existing, page.url);
  if (duplicate) return { status: 'duplicate', pin: duplicate };

  const pin = await repo.addPin(sessionId, {
    url: page.url,
    title: page.title === '' ? page.url : page.title,
    kind: detectKind(page.url),
    faviconUrl: page.faviconUrl,
  });
  // D11: until the LLM names the session, its title is the first pinned
  // page's title. The repository never replaces a `user` title, and a
  // `fallback` source is checked here so an `llm` title stays too.
  if (existing.length === 0 && session.titleSource === 'fallback') {
    await repo.setSessionTitle(sessionId, pin.title, 'fallback');
  }
  await deps.broadcast({ type: 'pins-changed', sessionId });
  return { status: 'pinned', pin, extraction: runExtraction(deps, pin, page) };
}

/**
 * Re-extracts pin `pinId` from the open tab `page` (D3). The pin shows
 * `extracting` meanwhile; its title and favicon follow the tab.
 */
export async function startRefresh(
  deps: PinDeps,
  pinId: string,
  page: PageRef,
): Promise<RefreshStart> {
  const pin = await deps.repo.updatePin(pinId, {
    status: 'extracting',
    failureReason: null,
    ...(page.title === '' ? {} : { title: page.title }),
    ...(page.faviconUrl ? { faviconUrl: page.faviconUrl } : {}),
  });
  if (!pin) return { status: 'refused', reason: 'not-found' };
  await deps.broadcast({ type: 'pins-changed', sessionId: pin.sessionId });
  return { status: 'refreshing', pin, extraction: runExtraction(deps, pin, page) };
}
