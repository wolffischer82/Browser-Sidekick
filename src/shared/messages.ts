import { browser } from 'wxt/browser';

/**
 * The one message union shared by all extension contexts (spec 6
 * "Messaging"). Every receiver checks messages with `isSidekickMessage`.
 * Messages carry ids only, never page content, URLs or titles.
 *
 * Requests (sidebar -> background, answered with a `PinOutcome`):
 * - `pin-tab`: pin tab `tabId` into session `sessionId`.
 * - `refresh-pin`: re-extract pin `pinId` from its open tab.
 *
 * Broadcasts (sent by whoever changed the data, to every other extension
 * page; the sender doesn't receive its own). A sidebar showing `sessionId`
 * re-reads that session and its pins from IndexedDB:
 * - `pins-changed`: a pin was added, updated (status, snapshot) or removed,
 *   or the session title changed with the first pin.
 * - `already-pinned`: a pin request found the page already pinned.
 *
 * PDF request (Chrome's background -> its offscreen document, answered with a
 * `PdfText`; decisions.md T09). The one message that carries a URL, and its
 * answer the extracted text; both stay inside the extension, and every other
 * receiver ignores it:
 * - `pdf-extract`: download `url` and extract its text with pdf.js;
 *   `requirePdfType` refuses a response that isn't `application/pdf`.
 */
export type SidekickMessage =
  | { type: 'pin-tab'; sessionId: string; tabId: number }
  | { type: 'refresh-pin'; pinId: string }
  | { type: 'pins-changed'; sessionId: string }
  | { type: 'already-pinned'; sessionId: string; pinId: string }
  | { type: 'pdf-extract'; url: string; requirePdfType: boolean };

export type SidekickRequest = Extract<SidekickMessage, { type: 'pin-tab' | 'refresh-pin' }>;
export type PdfExtractRequest = Extract<SidekickMessage, { type: 'pdf-extract' }>;
export type SidekickBroadcast = Exclude<SidekickMessage, SidekickRequest | PdfExtractRequest>;

/** Why a pin or refresh request did nothing. */
export type RefusalReason = 'restricted' | 'no-access' | 'not-open' | 'not-found';

/** The background's answer to a request. */
export type PinOutcome =
  | { status: 'pinned'; pinId: string }
  | { status: 'duplicate'; pinId: string }
  | { status: 'refreshing'; pinId: string }
  | { status: 'refused'; reason: RefusalReason };

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null;
}

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '';

export function isSidekickMessage(value: unknown): value is SidekickMessage {
  if (!isObject(value)) return false;
  switch (value.type) {
    case 'pin-tab':
      return isId(value.sessionId) && Number.isInteger(value.tabId);
    case 'refresh-pin':
      return isId(value.pinId);
    case 'pins-changed':
      return isId(value.sessionId);
    case 'already-pinned':
      return isId(value.sessionId) && isId(value.pinId);
    case 'pdf-extract':
      return (
        typeof value.url === 'string' &&
        /^https?:\/\//i.test(value.url) &&
        typeof value.requirePdfType === 'boolean'
      );
    default:
      return false;
  }
}

const REASONS: readonly string[] = ['restricted', 'no-access', 'not-open', 'not-found'];

export function isPinOutcome(value: unknown): value is PinOutcome {
  if (!isObject(value)) return false;
  switch (value.status) {
    case 'pinned':
    case 'duplicate':
    case 'refreshing':
      return isId(value.pinId);
    case 'refused':
      return typeof value.reason === 'string' && REASONS.includes(value.reason);
    default:
      return false;
  }
}

/**
 * Tells every other open extension page about a change. Having no receiver
 * (no sidebar open) is normal, so failures are ignored.
 */
export async function broadcast(message: SidekickBroadcast): Promise<void> {
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // No page is listening.
  }
}

/** Sends a request to the background and checks its answer. */
export async function sendToBackground(message: SidekickRequest): Promise<PinOutcome> {
  const reply: unknown = await browser.runtime.sendMessage(message);
  if (!isPinOutcome(reply)) throw new Error('Unexpected reply from the background.');
  return reply;
}
