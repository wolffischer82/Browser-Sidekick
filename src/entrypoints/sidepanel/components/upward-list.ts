import type { RefObject } from 'preact';
import { useLayoutEffect } from 'preact/hooks';

/** Space kept between an open list and the panel's edges, in px. */
const EDGE = 8;

/**
 * Places an open composer menu list (redesign spec 5.4): it opens upward
 * from its button, aligned to the button's left edge (CSS), no taller than
 * the space above the button, so it scrolls inside, and shifted left when
 * it would run past the panel's right edge.
 */
export function useUpwardList(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const button = anchor.current;
    const el = list.current;
    if (!open || !button || !el) return;
    const place = () => {
      const top = button.getBoundingClientRect().top;
      el.style.maxHeight = `${String(Math.max(0, Math.floor(top - 2 * EDGE)))}px`;
      el.style.left = '0px';
      const rect = el.getBoundingClientRect();
      const overflow = rect.right - (document.documentElement.clientWidth - EDGE);
      if (overflow > 0) el.style.left = `${String(-Math.min(overflow, rect.left - EDGE))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
    };
  }, [open]);
}
