import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  PAGE_SCRIPT,
  detectKind,
  extractTab,
  pageExtractor,
  type Extractor,
} from '@/shared/extract';

type Results = Awaited<ReturnType<typeof fakeBrowser.scripting.executeScript>>;

function scriptReturns(result: unknown) {
  return vi
    .spyOn(fakeBrowser.scripting, 'executeScript')
    .mockResolvedValue([{ frameId: 0, documentId: 'd', result }] as Results);
}

const PAGE = {
  title: 'Night trains',
  text: 'Sleeper trains are back.',
  truncated: false,
  method: 'readability',
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('extractTab', () => {
  it('injects the page extractor into the tab and returns its text', async () => {
    const spy = scriptReturns(PAGE);
    const result = await extractTab(7, 'https://example.com/a');
    expect(spy).toHaveBeenCalledWith({ target: { tabId: 7 }, files: [PAGE_SCRIPT] });
    expect(result).toEqual({
      ok: true,
      kind: 'page',
      title: 'Night trains',
      text: 'Sleeper trains are back.',
      charCount: 24,
      truncated: false,
    });
  });

  it('passes the truncated mark on', async () => {
    scriptReturns({ ...PAGE, truncated: true });
    expect(await extractTab(7, 'https://example.com/a')).toMatchObject({
      ok: true,
      truncated: true,
    });
  });

  it('refuses restricted pages without injecting', async () => {
    const spy = scriptReturns(PAGE);
    for (const url of ['chrome://settings/', 'file:///tmp/a.html', 'view-source:https://a.b/']) {
      expect(await extractTab(1, url)).toEqual({ ok: false, kind: 'page', reason: 'restricted' });
    }
    expect(
      await extractTab(1, 'https://addons.mozilla.org/', { browser: 'firefox' }),
    ).toMatchObject({
      reason: 'restricted',
    });
    expect(
      await extractTab(1, 'https://chromewebstore.google.com/', { browser: 'chrome' }),
    ).toMatchObject({
      reason: 'restricted',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports missing access (Chrome and Firefox wording)', async () => {
    const spy = vi.spyOn(fakeBrowser.scripting, 'executeScript');
    spy.mockRejectedValueOnce(
      new Error(
        'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
      ),
    );
    expect(await extractTab(1, 'https://example.com/')).toMatchObject({
      ok: false,
      reason: 'no-access',
    });
    spy.mockRejectedValueOnce(new Error('Missing host permission for the tab'));
    expect(await extractTab(1, 'https://example.com/')).toMatchObject({
      ok: false,
      reason: 'no-access',
    });
  });

  it('reports other script failures as unreadable', async () => {
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockRejectedValue(
      new Error('No tab with id: 1.'),
    );
    expect(await extractTab(1, 'https://example.com/')).toEqual({
      ok: false,
      kind: 'page',
      reason: 'unreadable',
    });
  });

  it('rejects a malformed script result', async () => {
    for (const bad of [undefined, null, 'text', { title: 'x' }, { ...PAGE, method: 'other' }]) {
      scriptReturns(bad);
      expect(await extractTab(1, 'https://example.com/')).toMatchObject({ reason: 'unreadable' });
    }
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([] as Results);
    expect(await extractTab(1, 'https://example.com/')).toMatchObject({ reason: 'unreadable' });
  });

  it('reports a page without text as empty', async () => {
    scriptReturns({ ...PAGE, text: '' });
    expect(await extractTab(1, 'https://example.com/')).toEqual({
      ok: false,
      kind: 'page',
      reason: 'empty',
    });
  });

  it('runs the first matching extractor and survives one that throws', async () => {
    const extract = vi.fn().mockRejectedValue(new Error('boom'));
    const special: Extractor = {
      kind: 'youtube',
      matches: (url) => url.hostname === 'www.youtube.com',
      extract,
    };
    const extractors = [special, pageExtractor];
    expect(await extractTab(3, 'https://www.youtube.com/watch?v=x', { extractors })).toEqual({
      ok: false,
      kind: 'youtube',
      reason: 'unreadable',
    });
    expect(extract).toHaveBeenCalledWith(3, 'https://www.youtube.com/watch?v=x');
    expect(detectKind('https://www.youtube.com/watch?v=x', extractors)).toBe('youtube');
    expect(detectKind('https://example.com/', extractors)).toBe('page');
  });

  it('treats an unparsable URL as restricted', async () => {
    expect(await extractTab(1, 'not a url')).toEqual({
      ok: false,
      kind: 'page',
      reason: 'restricted',
    });
    expect(detectKind('not a url')).toBe('page');
  });
});
