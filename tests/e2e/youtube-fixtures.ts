import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';

// YouTube served from the synthetic fixtures in tests/fixtures/youtube
// (T08), shared by the YouTube and Session tabs suites. No request reaches
// YouTube: other requests to its hosts are aborted, and NO_YOUTUBE_ARGS maps
// those hosts to a closed local port.

const FIXTURES = resolve(import.meta.dirname, '../fixtures/youtube');
const CAPTIONED_HTML = readFileSync(resolve(FIXTURES, 'watch-captions.html'), 'utf8');
const SILENT_HTML = readFileSync(resolve(FIXTURES, 'watch-no-captions.html'), 'utf8');
const PANEL = readFileSync(resolve(FIXTURES, 'panel.json'), 'utf8');

/** Watch pages by video id; VIDEO000003 is a captioned Short. */
const WATCH_PAGES: Record<string, string> = {
  VIDEO000001: CAPTIONED_HTML,
  VIDEO000002: SILENT_HTML,
  VIDEO000003: CAPTIONED_HTML.replaceAll('VIDEO000001', 'VIDEO000003')
    .replaceAll('Placeholder captioned video', 'Placeholder captioned short')
    .replace(
      'Placeholder captioned short - YouTube',
      'Placeholder captioned short #shorts - YouTube',
    ),
};

const YOUTUBE_HOSTS =
  /^https?:\/\/([^/]+\.)?(youtube\.com|youtu\.be|ytimg\.com|googlevideo\.com|ggpht\.com)(:\d+)?\//;
export const NO_YOUTUBE_ARGS = [
  '--host-resolver-rules=MAP *.youtube.com 127.0.0.1:9, MAP youtube.com 127.0.0.1:9, MAP youtu.be 127.0.0.1:9, MAP *.ytimg.com 127.0.0.1:9, MAP *.googlevideo.com 127.0.0.1:9, MAP *.ggpht.com 127.0.0.1:9',
];

const html = (body: string) => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body,
});

/** Serves the fixtures; records the `hl` of each transcript request. */
export async function serveYouTube(context: BrowserContext): Promise<string[]> {
  const languages: string[] = [];
  await context.route(YOUTUBE_HOSTS, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== 'www.youtube.com') return route.abort();
    const id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : url.pathname.startsWith('/shorts/')
          ? url.pathname.split('/')[2]
          : null;
    const page = id ? WATCH_PAGES[id] : undefined;
    if (page) return route.fulfill(html(page));
    if (url.pathname === '/youtubei/v1/get_panel' && request.method() === 'POST') {
      const body = request.postDataJSON() as { context?: { client?: { hl?: string } } };
      languages.push(body.context?.client?.hl ?? '');
      return route.fulfill({ status: 200, contentType: 'application/json', body: PANEL });
    }
    return route.abort();
  });
  return languages;
}
