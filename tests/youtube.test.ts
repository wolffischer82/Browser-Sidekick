import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chooseLanguage,
  fallbackText,
  formatTimestamp,
  formatTranscript,
  panelContext,
  parseTimestamp,
  parseTranscriptPanel,
  parseWatchPage,
  readJsonAssignment,
  youtubeVideoId,
} from '@/shared/extract/youtube';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/youtube');
const fixture = (name: string) => readFileSync(resolve(FIXTURES, name), 'utf8');
const CAPTIONS = fixture('watch-captions.html');
const NO_CAPTIONS = fixture('watch-no-captions.html');
const PANEL: unknown = JSON.parse(fixture('panel.json'));

describe('youtubeVideoId (detection)', () => {
  const ID = 'dQw4w9WgXcQ';
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}&t=42s`, ID],
    [`https://www.youtube.com/watch?list=PL1&v=${ID}&index=3`, ID],
    [`https://www.youtube.com/watch?v=${ID}#comments`, ID],
    [`http://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?t=10`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://youtube.com/shorts/${ID}/`, ID],
    [`https://m.youtube.com/shorts/${ID}?feature=share`, ID],
  ])('%s -> video %s', (url, id) => {
    expect(youtubeVideoId(new URL(url))).toBe(id);
  });

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ/../x',
    'https://www.youtube.com/results?search_query=trains',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/',
    'https://youtu.be/',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.example.org/watch?v=dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
  ])('%s is not a video', (url) => {
    expect(youtubeVideoId(new URL(url))).toBeNull();
  });
});

describe('readJsonAssignment', () => {
  it('reads an object assigned in the HTML, with braces and quotes inside strings', () => {
    const pr = readJsonAssignment(CAPTIONS, 'ytInitialPlayerResponse') as {
      videoDetails: { shortDescription: string };
    };
    expect(pr.videoDetails.shortDescription).toBe(
      'A synthetic description.\nIt mentions {braces}; "quotes" and </script> safely.',
    );
  });

  it('accepts the window["name"] form', () => {
    expect(
      readJsonAssignment('<script>window["ytInitialData"] = {"a":[1,{"b":"}"}]};', 'ytInitialData'),
    ).toEqual({ a: [1, { b: '}' }] });
  });

  it('returns null when missing, unterminated or invalid', () => {
    expect(readJsonAssignment('<html></html>', 'ytInitialData')).toBeNull();
    expect(readJsonAssignment('var ytInitialData = {"a":"b"', 'ytInitialData')).toBeNull();
    expect(readJsonAssignment('var ytInitialData = {a:1};', 'ytInitialData')).toBeNull();
    expect(readJsonAssignment('var ytInitialData = null;', 'ytInitialData')).toBeNull();
    expect(readJsonAssignment('var ytInitialDataX = {"a":1};', 'ytInitialData')).toBeNull();
  });
});

describe('parseWatchPage', () => {
  it('reads title, description, caption languages, panel params and client version', () => {
    expect(parseWatchPage(CAPTIONS)).toEqual({
      videoId: 'VIDEO000001',
      title: 'Placeholder captioned video',
      description: 'A synthetic description.\nIt mentions {braces}; "quotes" and </script> safely.',
      languages: ['en', 'en', 'de-DE'],
      panelParams: 'PANEL_PARAMS_VIDEO000001',
      clientVersion: '2.20260930.00.00',
    });
  });

  it('has no languages and no panel for a video without captions', () => {
    expect(parseWatchPage(NO_CAPTIONS)).toEqual({
      videoId: 'VIDEO000002',
      title: 'Placeholder silent video',
      description: 'Synthetic footage without speech.',
      languages: [],
      panelParams: null,
      clientVersion: '2.20260930.00.00',
    });
  });

  it('finds the panel params behind the Transcript chip of videos with chapters', () => {
    const html =
      'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"VIDEO000004","title":"T"},' +
      '"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"languageCode":"en"}]}}};' +
      'var ytInitialData = {"engagementPanels":[{"engagementPanelSectionListRenderer":{"header":{"chipBarViewModel":{"chips":[' +
      '{"chipViewModel":{"text":"Timeline","tapCommand":{"innertubeCommand":{"commandExecutorCommand":{"commands":[{"updateEngagementPanelContentCommand":{"targetPanelIdentifier":{"surface":"ENGAGEMENT_PANEL_SURFACE_WATCH","tag":"PAtimeline"},"contentSourcePanelIdentifier":{"surface":"ENGAGEMENT_PANEL_SURFACE_WATCH","tag":"PAmacro_markers"},"globalConfiguration":{"params":"OTHER_PANEL"}}}]}}}}},' +
      '{"chipViewModel":{"text":"Transcript","tapCommand":{"innertubeCommand":{"commandExecutorCommand":{"commands":[{"updateEngagementPanelContentCommand":{"targetPanelIdentifier":{"surface":"ENGAGEMENT_PANEL_SURFACE_WATCH","tag":"PAtimeline"},"contentSourcePanelIdentifier":{"surface":"ENGAGEMENT_PANEL_SURFACE_WATCH","tag":"PAmodern_transcript_view"},"globalConfiguration":{"params":"PANEL_PARAMS_VIDEO000004"}}}]}}}}}' +
      ']}}}}]};';
    expect(parseWatchPage(html)?.panelParams).toBe('PANEL_PARAMS_VIDEO000004');
  });

  it('ignores the legacy get_transcript params', () => {
    expect(CAPTIONS).toContain('LEGACY_PARAMS_PLACEHOLDER');
    expect(parseWatchPage(CAPTIONS)?.panelParams).toBe('PANEL_PARAMS_VIDEO000001');
  });

  it('returns null without a usable player response', () => {
    expect(parseWatchPage('<html><body>Consent</body></html>')).toBeNull();
    expect(
      parseWatchPage('var ytInitialPlayerResponse = {"videoDetails":{"title":"x"}};'),
    ).toBeNull();
    expect(
      parseWatchPage('var ytInitialPlayerResponse = {"videoDetails":{"videoId":"x","title":7}};'),
    ).toBeNull();
  });

  it('keeps only well-formed values from untrusted data', () => {
    const html =
      'var ytInitialPlayerResponse = {"videoDetails":{"videoId":"VIDEO000003","title":"T","shortDescription":5},' +
      '"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"languageCode":7},{"languageCode":"fr"},"x",{"languageCode":"<b>"}]}}};';
    expect(parseWatchPage(html)).toEqual({
      videoId: 'VIDEO000003',
      title: 'T',
      description: '',
      languages: ['fr'],
      panelParams: null,
      clientVersion: null,
    });
  });
});

describe('chooseLanguage', () => {
  it('prefers the page language, exact or by base language', () => {
    expect(chooseLanguage(['en', 'de-DE', 'ja'], 'de-DE')).toBe('de-DE');
    expect(chooseLanguage(['en', 'de-DE', 'ja'], 'de')).toBe('de-DE');
    expect(chooseLanguage(['en', 'de', 'ja'], 'de-AT')).toBe('de');
    expect(chooseLanguage(['pt-PT', 'pt-BR'], 'pt-BR')).toBe('pt-BR');
    expect(chooseLanguage(['en', 'JA'], 'ja')).toBe('JA');
  });

  it('falls back to the first track', () => {
    expect(chooseLanguage(['en', 'ja'], 'fr')).toBe('en');
    expect(chooseLanguage(['ja'], '')).toBe('ja');
  });

  it('has nothing to choose without tracks', () => {
    expect(chooseLanguage([], 'en')).toBeNull();
  });
});

describe('panelContext', () => {
  it("uses the page's context with the chosen language", () => {
    const page = { client: { hl: 'en', clientName: 'WEB', clientVersion: '2.1' }, user: {} };
    const context = panelContext(page, '2.9', 'de-DE');
    expect(context).toEqual({
      client: { hl: 'de-DE', clientName: 'WEB', clientVersion: '2.1' },
      user: {},
    });
    expect(page.client.hl).toBe('en');
  });

  it('builds a minimal web context when the page has none', () => {
    for (const bad of [undefined, null, 'x', {}, { client: 'x' }]) {
      expect(panelContext(bad, '2.9', 'ja')).toEqual({
        client: { clientName: 'WEB', clientVersion: '2.9', hl: 'ja' },
      });
    }
    expect(panelContext(null, null, 'ja')).toBeNull();
  });
});

describe('parseTimestamp and formatTimestamp', () => {
  it('parses m:ss and h:mm:ss', () => {
    expect(parseTimestamp('0:01')).toBe(1);
    expect(parseTimestamp('12:34')).toBe(754);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp(' 1:05 ')).toBe(65);
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'x', '1', '1:5', '1:60', '1:2:3:4', '-1:00', '1:00x']) {
      expect(parseTimestamp(bad), bad).toBeNull();
    }
  });

  it('formats [mm:ss] markers, minutes past the hour included', () => {
    expect(formatTimestamp(0)).toBe('[00:00]');
    expect(formatTimestamp(65)).toBe('[01:05]');
    expect(formatTimestamp(3723)).toBe('[62:03]');
    expect(formatTimestamp(6000.9)).toBe('[100:00]');
  });
});

describe('parseTranscriptPanel', () => {
  it('reads the segments in order with their start times', () => {
    const segments = parseTranscriptPanel(PANEL);
    expect(segments).toHaveLength(8);
    expect(segments[0]).toEqual({ start: 1, text: 'This is a synthetic first sentence.' });
    expect(segments[5]).toEqual({ start: 41, text: 'Whitespace is collapsed.' });
    expect(segments[7]).toEqual({ start: 100, text: 'The last synthetic line.' });
  });

  it('skips malformed and empty segments', () => {
    const panel = {
      items: [
        { transcriptSegmentViewModel: { simpleText: 'Kept.', timestamp: '0:05' } },
        { transcriptSegmentViewModel: { simpleText: 7, timestamp: '0:06' } },
        { transcriptSegmentViewModel: { simpleText: 'No time.', timestamp: 'soon' } },
        { transcriptSegmentViewModel: { simpleText: '   ', timestamp: '0:07' } },
        { transcriptSegmentViewModel: 'x' },
        { transcriptSegmentViewModel: { simpleText: 'Also kept.', timestamp: '0:08' } },
      ],
    };
    expect(parseTranscriptPanel(panel)).toEqual([
      { start: 5, text: 'Kept.' },
      { start: 8, text: 'Also kept.' },
    ]);
  });

  it('returns no segments for anything else', () => {
    for (const bad of [
      undefined,
      null,
      'x',
      5,
      {},
      [],
      { error: { status: 'FAILED_PRECONDITION' } },
    ]) {
      expect(parseTranscriptPanel(bad)).toEqual([]);
    }
  });

  it('survives deeply nested input', () => {
    let deep: unknown = {
      transcriptSegmentViewModel: { simpleText: 'Too deep.', timestamp: '0:01' },
    };
    for (let i = 0; i < 10_000; i++) deep = { a: deep };
    expect(parseTranscriptPanel(deep)).toEqual([]);
  });
});

describe('formatTranscript', () => {
  it('writes blocks that start with a [mm:ss] marker about every 30 seconds', () => {
    expect(formatTranscript(parseTranscriptPanel(PANEL))).toBe(
      [
        '[00:01] This is a synthetic first sentence. It stands in for real captions. Each segment has a timestamp. Markers appear about every thirty seconds.',
        '[00:33] This line starts a new block. Whitespace is collapsed.',
        '[01:05] A later block begins here.',
        '[01:40] The last synthetic line.',
      ].join('\n'),
    );
  });

  it('is empty without segments', () => {
    expect(formatTranscript([])).toBe('');
  });
});

describe('fallbackText', () => {
  it('joins title, description and the note', () => {
    expect(fallbackText('A video', 'About it.\nMore.', 'No transcript available.')).toBe(
      'A video\n\nAbout it.\nMore.\n\nNo transcript available.',
    );
  });

  it('leaves out an empty description', () => {
    expect(fallbackText('A video', '  ', 'No transcript available.')).toBe(
      'A video\n\nNo transcript available.',
    );
  });
});
