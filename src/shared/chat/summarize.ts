import type { CurrentTab } from '../current-tab';
import type { Pin, ProviderConfig } from '../model';
import { requestCurrentTab, type CurrentTabRef } from './context';

/**
 * Summarize (spec 5.6, D4). Pure: which pages a summary covers, why the
 * button can or can't be used, and the short wait for pins that are still
 * being read when the button is pressed. The request itself is the ask flow
 * with the fixed prompt (`useChat`).
 */

/** The pages a summary covers (D4). */
export interface SummaryPageSet {
  /** The ready pins, in pin order. Failed and extracting pins are left out. */
  pins: Pin[];
  /** The current tab, when it is readable, not excluded and not already pinned. */
  currentTab: CurrentTabRef | null;
  /** How many pages that is. */
  count: number;
}

export function summaryPageSet(
  pins: readonly Pin[],
  current: CurrentTab,
  excluded: boolean,
): SummaryPageSet {
  const ready = pins.filter((pin) => pin.status === 'ready');
  const currentTab = requestCurrentTab(current, excluded, pins);
  return { pins: ready, currentTab, count: ready.length + (currentTab ? 1 : 0) };
}

/** Whether Summarize can be used, or why not (spec 5.6: disabled with a tooltip). */
export type SummarizeState =
  | { kind: 'ready' }
  /** No usable provider, or the session has no model yet. */
  | { kind: 'noProvider' }
  /** The session's provider has no host access (spec 5.7). */
  | { kind: 'noAccess'; providerLabel: string }
  /** An answer of this session is on its way. */
  | { kind: 'busy' }
  /** Nothing pinned is ready and the current tab isn't covered. */
  | { kind: 'nothing' };

export interface SummarizeStateInput {
  /** The session's provider, if it still exists. */
  provider: ProviderConfig | undefined;
  model: string | null;
  busy: boolean;
  pages: SummaryPageSet;
}

export function summarizeState({
  provider,
  model,
  busy,
  pages,
}: SummarizeStateInput): SummarizeState {
  if (!provider || !model) return { kind: 'noProvider' };
  if (!provider.hasAccess) return { kind: 'noAccess', providerLabel: provider.label };
  if (busy) return { kind: 'busy' };
  if (pages.count === 0) return { kind: 'nothing' };
  return { kind: 'ready' };
}

/**
 * How long a summary waits for pins that are still being read, and how often
 * it looks. An object so tests can shorten it.
 */
export const pinWait = { timeoutMs: 10_000, pollMs: 250 };

export interface PinsAfterWait {
  pins: Pin[];
  /** Pins still extracting after the wait; they are left out. */
  stillExtracting: number;
}

const extracting = (pins: readonly Pin[]) => pins.filter((p) => p.status === 'extracting').length;

/**
 * Reads the pins, waiting up to `pinWait.timeoutMs` while any is still
 * extracting. `onWait` is called once, when the wait starts. Ends early when
 * `signal` is aborted (Stop).
 */
export async function waitForPins(
  listPins: () => Promise<Pin[]>,
  signal: AbortSignal,
  onWait: () => void,
): Promise<PinsAfterWait> {
  // A function, so the check is made afresh after each pause.
  const stopped = () => signal.aborted;
  let pins = await listPins();
  let waited = 0;
  while (extracting(pins) > 0 && waited < pinWait.timeoutMs && !stopped()) {
    if (waited === 0) onWait();
    await new Promise((resolve) => setTimeout(resolve, pinWait.pollMs));
    waited += pinWait.pollMs;
    if (stopped()) break;
    pins = await listPins();
  }
  return { pins, stillExtracting: extracting(pins) };
}
