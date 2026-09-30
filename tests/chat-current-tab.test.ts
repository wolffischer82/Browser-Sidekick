import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readCurrentTabText } from '@/shared/chat/current-tab-text';
import { PAGE_SCRIPT } from '@/shared/extract';
import type { PdfRunner } from '@/shared/extract/pdf-extractor';

// The current tab read on demand at send time (spec 5.5, 5.6), through the
// dispatcher, with PDFs read in the sidebar itself (decisions.md T10).

type Results = Awaited<ReturnType<typeof fakeBrowser.scripting.executeScript>>;

beforeEach(() => {
  fakeBrowser.reset();
});

const PAGE = { title: 'Extracted', text: 'Page text.', truncated: false, method: 'readability' };

describe('readCurrentTabText', () => {
  it('injects the page extractor and returns the text with the tab title', async () => {
    const spy = vi
      .spyOn(fakeBrowser.scripting, 'executeScript')
      .mockResolvedValue([{ frameId: 0, documentId: 'd', result: PAGE }] as Results);
    const page = await readCurrentTabText(
      { tabId: 4, url: 'https://news.example/a', title: 'Tab title' },
      { runPdf: vi.fn<PdfRunner>() },
    );
    expect(spy).toHaveBeenCalledWith({ target: { tabId: 4 }, files: [PAGE_SCRIPT] });
    expect(page).toEqual({ title: 'Tab title', url: 'https://news.example/a', text: 'Page text.' });
  });

  it('reads a PDF with the sidebar runner, not the offscreen document', async () => {
    const script = vi.spyOn(fakeBrowser.scripting, 'executeScript');
    const runPdf = vi.fn<PdfRunner>().mockResolvedValue({
      ok: true,
      title: 'Meta title',
      text: 'PDF text.',
      truncated: false,
    });
    const page = await readCurrentTabText(
      { tabId: 4, url: 'https://files.example/report.pdf', title: '' },
      { runPdf },
    );
    expect(runPdf).toHaveBeenCalledWith('https://files.example/report.pdf', false);
    expect(script).not.toHaveBeenCalled();
    expect(page).toEqual({
      title: 'Meta title',
      url: 'https://files.example/report.pdf',
      text: 'PDF text.',
    });
  });

  it('probes a page that failed for a PDF by Content-Type', async () => {
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockResolvedValue([
      { frameId: 0, documentId: 'd', result: { ...PAGE, text: '' } },
    ] as Results);
    const runPdf = vi
      .fn<PdfRunner>()
      .mockResolvedValue({ ok: true, title: '', text: 'Viewer PDF.', truncated: false });
    const page = await readCurrentTabText(
      { tabId: 4, url: 'https://files.example/view/7', title: 'Report' },
      { runPdf },
    );
    expect(runPdf).toHaveBeenCalledWith('https://files.example/view/7', true);
    expect(page?.text).toBe('Viewer PDF.');
  });

  it('returns null when the tab can not be read', async () => {
    vi.spyOn(fakeBrowser.scripting, 'executeScript').mockRejectedValue(
      new Error('Cannot access contents of the page.'),
    );
    const page = await readCurrentTabText(
      { tabId: 4, url: 'https://news.example/a', title: 'Tab' },
      { runPdf: vi.fn<PdfRunner>().mockResolvedValue({ ok: false, reason: 'not-pdf' }) },
    );
    expect(page).toBeNull();
  });

  it('returns null for a restricted page without touching it', async () => {
    const script = vi.spyOn(fakeBrowser.scripting, 'executeScript');
    expect(
      await readCurrentTabText({ tabId: 4, url: 'chrome://settings/', title: 'Settings' }),
    ).toBeNull();
    expect(script).not.toHaveBeenCalled();
  });

  it('returns null when the extractor throws', async () => {
    const page = await readCurrentTabText(
      { tabId: 4, url: 'https://news.example/a', title: 'Tab' },
      { extract: () => Promise.reject(new Error('boom')) },
    );
    expect(page).toBeNull();
  });
});
