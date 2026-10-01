/**
 * YouTube transcripts (spec 5.5, kind "YouTube"; method chosen in
 * decisions.md T08-2). Pure parsers for what the page hands back: the fresh
 * watch-page HTML (`ytInitialPlayerResponse`, `ytInitialData`) and the
 * InnerTube `get_panel` response of the transcript panel. Everything they
 * read comes from the page and is untrusted: only well-formed strings and
 * numbers are kept, walks are bounded, and nothing is logged.
 */

/** The panel YouTube's own "Show transcript" button opens. */
export const TRANSCRIPT_PANEL_ID = 'PAmodern_transcript_view';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/**
 * The video id of a watch, Shorts or `youtu.be` URL (spec 5.5 detection),
 * else null. Other YouTube pages (home, search, channels, embeds, YouTube
 * Music) are read as generic pages.
 */
export function youtubeVideoId(url: URL): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let id: string | null | undefined = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Index just past the JSON object starting at `start` (a `{`), or -1. */
function endOfObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The JSON object the watch page assigns to `name` in an inline script
 * (`var name = {…};` or `window["name"] = {…};`), or null.
 */
export function readJsonAssignment(html: string, name: string): unknown {
  const pattern = new RegExp(`(?:\\bvar\\s+${name}|window\\[["']${name}["']\\])\\s*=\\s*\\{`);
  const match = pattern.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  const end = endOfObject(html, start);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end)) as unknown;
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Depth-first walk in document order, bounded in depth and size so a hostile
 * page can't make it run away. Calls `visit` on every object; a `true`
 * return stops descending into that object.
 */
function walk(root: unknown, visit: (node: Json) => boolean): void {
  const MAX_DEPTH = 64;
  const MAX_NODES = 1_000_000;
  const stack: [unknown, number][] = [[root, 0]];
  let seen = 0;
  for (let entry = stack.pop(); entry !== undefined && seen < MAX_NODES; entry = stack.pop()) {
    const [node, depth] = entry;
    seen++;
    if (typeof node !== 'object' || node === null || depth > MAX_DEPTH) continue;
    if (!Array.isArray(node) && visit(node as Json)) continue;
    const children = Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
  }
}

const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
const PANEL_PARAMS = /^[A-Za-z0-9_\-%=]{1,2000}$/;
const CLIENT_VERSION = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([0-9.]{1,40})"/;

export interface WatchPage {
  videoId: string;
  title: string;
  description: string;
  /** Caption track languages in YouTube's order (duplicates for manual and auto tracks). */
  languages: string[];
  /** `get_panel` params of the transcript panel; null when the video has none. */
  panelParams: string | null;
  /** The web client version, for a minimal InnerTube context. */
  clientVersion: string | null;
}

/**
 * The `get_panel` params of the transcript panel. YouTube links the panel
 * from "Show transcript" (`showEngagementPanelEndpoint.identifier`) and, for
 * videos with chapters, from a "Transcript" chip
 * (`updateEngagementPanelContentCommand.contentSourcePanelIdentifier`), so
 * any object whose panel identifier names the transcript panel and that
 * carries `globalConfiguration.params` counts.
 */
function transcriptPanelParams(data: unknown): string | null {
  let params: string | null = null;
  walk(data, (node) => {
    if (params !== null) return true;
    const value = field(node, 'globalConfiguration', 'params');
    if (typeof value !== 'string') return false;
    const names = Object.values(node).some((v) => field(v, 'tag') === TRANSCRIPT_PANEL_ID);
    if (names && PANEL_PARAMS.test(value)) params = value;
    return names;
  });
  return params;
}

/** Reads a fetched watch page; null without a usable player response. */
export function parseWatchPage(html: string): WatchPage | null {
  const player = readJsonAssignment(html, 'ytInitialPlayerResponse');
  const videoId = field(player, 'videoDetails', 'videoId');
  const title = field(player, 'videoDetails', 'title');
  if (typeof videoId !== 'string' || typeof title !== 'string') return null;
  const description = field(player, 'videoDetails', 'shortDescription');
  const tracks = field(player, 'captions', 'playerCaptionsTracklistRenderer', 'captionTracks');
  const languages = (Array.isArray(tracks) ? tracks : [])
    .map((track) => field(track, 'languageCode'))
    .filter((code): code is string => typeof code === 'string' && LANGUAGE.test(code));
  return {
    videoId,
    title: title.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    languages,
    panelParams: transcriptPanelParams(readJsonAssignment(html, 'ytInitialData')),
    clientVersion: CLIENT_VERSION.exec(html)?.[1] ?? null,
  };
}

const base = (code: string) => (code.split('-')[0] ?? '').toLowerCase();

/**
 * The transcript language (spec 5.5): the page's language if a track has it
 * (exactly, else by base language), else the first track; null without tracks.
 */
export function chooseLanguage(languages: string[], pageLanguage: string): string | null {
  const wanted = pageLanguage.trim().toLowerCase();
  return (
    languages.find((code) => code.toLowerCase() === wanted) ??
    languages.find((code) => base(code) === base(wanted)) ??
    languages[0] ??
    null
  );
}

/**
 * The InnerTube context for `get_panel`: the page's own context with `hl`
 * set to `language` (which picks the transcript track, decisions.md T08-1),
 * else a minimal web client context; null if neither is possible.
 */
export function panelContext(
  pageContext: unknown,
  clientVersion: string | null,
  language: string,
): Json | null {
  if (isObject(pageContext) && isObject(pageContext.client)) {
    return { ...pageContext, client: { ...pageContext.client, hl: language } };
  }
  if (clientVersion === null) return null;
  return { client: { clientName: 'WEB', clientVersion, hl: language } };
}

/** `m:ss` or `h:mm:ss` to seconds; null for anything else. */
export function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d{1,3}):)?(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  if (hours !== undefined && Number(minutes) > 59) return null;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** A `[mm:ss]` marker; minutes keep counting past the hour. */
export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(whole / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `[${mm}:${ss}]`;
}

export interface Segment {
  /** Start time in seconds. */
  start: number;
  text: string;
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The transcript segments of a `get_panel` response, in order. */
export function parseTranscriptPanel(panel: unknown): Segment[] {
  const segments: Segment[] = [];
  walk(panel, (node) => {
    if (!('transcriptSegmentViewModel' in node)) return false;
    const segment = node.transcriptSegmentViewModel;
    const text = field(segment, 'simpleText');
    const timestamp = field(segment, 'timestamp');
    if (typeof text !== 'string' || typeof timestamp !== 'string') return true;
    const start = parseTimestamp(timestamp);
    const clean = tidy(text);
    if (start !== null && clean !== '') segments.push({ start, text: clean });
    return true;
  });
  return segments;
}

/** A new `[mm:ss]` block starts once this many seconds have passed. */
const BLOCK_SECONDS = 30;

/** Plain text, one line per block of about 30 seconds, each starting with its `[mm:ss]` marker. */
export function formatTranscript(segments: Segment[]): string {
  const lines: string[] = [];
  let blockStart = -Infinity;
  for (const segment of segments) {
    const last = lines.length - 1;
    if (last < 0 || segment.start >= blockStart + BLOCK_SECONDS) {
      blockStart = segment.start;
      lines.push(`${formatTimestamp(segment.start)} ${segment.text}`);
    } else {
      lines[last] = `${lines[last] ?? ''} ${segment.text}`;
    }
  }
  return lines.join('\n');
}

/** Spec 5.5 fallback: title, description and the "No transcript available" note. */
export function fallbackText(title: string, description: string, note: string): string {
  return [title, description, note]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n\n');
}
