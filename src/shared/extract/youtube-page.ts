/**
 * Functions injected into a YouTube tab's MAIN world with
 * `scripting.executeScript({ world: 'MAIN', func, args })` (decisions.md
 * T08-2). The browser serialises each function on its own, so they must stay
 * self-contained: no imports, no module-level helpers. They only fetch what
 * the page itself would fetch and hand it back; the extension parses it as
 * untrusted data. Nothing is logged.
 */

export interface WatchPageRaw {
  /** The page's UI language (`ytcfg` `HL`, else `<html lang>`). */
  language: string;
  /** The page's InnerTube context, as plain JSON, or null. */
  context: unknown;
  /** Fresh HTML of `/watch?v=<id>`, or null if the request failed. */
  html: string | null;
}

/**
 * Reads the page's language and InnerTube context and fetches the watch page
 * of `videoId` afresh, so in-app navigation never leaves stale data behind.
 */
export async function readWatchPage(videoId: string): Promise<WatchPageRaw> {
  const config = (window as unknown as { ytcfg?: { get?: (key: string) => unknown } }).ytcfg;
  const read = (key: string): unknown => {
    try {
      return typeof config?.get === 'function' ? config.get(key) : undefined;
    } catch {
      return undefined;
    }
  };
  const hl = read('HL');
  let context: unknown;
  try {
    context = JSON.parse(JSON.stringify(read('INNERTUBE_CONTEXT') ?? null)) as unknown;
  } catch {
    context = null;
  }
  let html: string | null = null;
  try {
    const response = await fetch(`/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: 'same-origin',
    });
    if (response.ok) html = await response.text();
  } catch {
    html = null;
  }
  return {
    language: typeof hl === 'string' ? hl : document.documentElement.lang,
    context,
    html,
  };
}

/** Requests the transcript panel from InnerTube, as YouTube's "Show transcript" does. */
export async function fetchTranscriptPanel(
  panelId: string,
  params: string,
  context: unknown,
): Promise<unknown> {
  try {
    const response = await fetch('/youtubei/v1/get_panel?prettyPrint=false', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context, panelId, params }),
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}
