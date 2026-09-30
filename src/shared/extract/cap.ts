/**
 * The per-pin text cap (spec 5.5), shared by every extractor. Kept apart
 * from `page.ts` so extractors that run in the background don't pull in
 * Readability.
 */

/** Extracted text is capped per pin (spec 5.5). */
export const MAX_TEXT_CHARS = 200_000;

/** Cuts `text` at `max` characters without splitting a surrogate pair. */
export function capText(
  text: string,
  max: number = MAX_TEXT_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}
