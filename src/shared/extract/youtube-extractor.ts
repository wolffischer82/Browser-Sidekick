import { browser } from 'wxt/browser';
import { t } from '../i18n';
import type { ExtractionFailure, ExtractionResult, Extractor } from '.';
import { isAccessError } from './access';
import { capText } from './cap';
import {
  TRANSCRIPT_PANEL_ID,
  chooseLanguage,
  fallbackText,
  formatTranscript,
  panelContext,
  parseTranscriptPanel,
  parseWatchPage,
  youtubeVideoId,
  type Segment,
} from './youtube';
import { fetchTranscriptPanel, readWatchPage, type WatchPageRaw } from './youtube-page';

/** A watch page is about 1–2 MB; anything far larger is not one. */
const MAX_HTML_CHARS = 16_000_000;

function isWatchPageRaw(value: unknown): value is WatchPageRaw {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.language === 'string' &&
    'context' in v &&
    (v.html === null || typeof v.html === 'string')
  );
}

const failed = (reason: ExtractionFailure): ExtractionResult => ({
  ok: false,
  kind: 'youtube',
  reason,
});

/**
 * YouTube videos (spec 5.5): the transcript in the page's language, else the
 * first track, as `[mm:ss]` blocks; without one, title, description and the
 * "No transcript available" note. Method: decisions.md T08-2.
 */
export const youtubeExtractor: Extractor = {
  kind: 'youtube',
  matches: (url) => youtubeVideoId(url) !== null,
  async extract(tabId, url) {
    const videoId = youtubeVideoId(new URL(url));
    if (videoId === null) return failed('unreadable');

    let raw: unknown;
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: readWatchPage,
        args: [videoId],
      });
      raw = results[0]?.result;
    } catch (error) {
      return failed(isAccessError(error) ? 'no-access' : 'unreadable');
    }
    if (!isWatchPageRaw(raw) || raw.html === null || raw.html.length > MAX_HTML_CHARS) {
      return failed('unreadable');
    }
    const page = parseWatchPage(raw.html);
    if (page?.videoId !== videoId) return failed('unreadable');

    let segments: Segment[] = [];
    const language = chooseLanguage(page.languages, raw.language);
    const context =
      language === null ? null : panelContext(raw.context, page.clientVersion, language);
    if (page.panelParams !== null && context !== null) {
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: fetchTranscriptPanel,
          args: [TRANSCRIPT_PANEL_ID, page.panelParams, context],
        });
        segments = parseTranscriptPanel(results[0]?.result);
      } catch {
        segments = [];
      }
    }

    const text =
      segments.length > 0
        ? formatTranscript(segments)
        : fallbackText(page.title, page.description, t('youtubeNoTranscript'));
    const capped = capText(text);
    return {
      ok: true,
      kind: 'youtube',
      title: page.title,
      text: capped.text,
      charCount: capped.text.length,
      truncated: capped.truncated,
    };
  },
};
