import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The store listing texts (`docs/store/listing.<lang>.md`). */
export function listingPath(lang: 'en' | 'de'): string {
  return resolve(import.meta.dirname, `../../docs/store/listing.${lang}.md`);
}

/**
 * The text of a listing field: the fenced `text` block under the `## <heading>`
 * of `docs/store/listing.<lang>.md`, without the final line break.
 */
export function listingField(lang: 'en' | 'de', heading: string): string {
  const markdown = readFileSync(listingPath(lang), 'utf8');
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`listing.${lang}.md has no "## ${heading}" section.`);
  const next = markdown.indexOf('\n## ', start + 1);
  const section = markdown.slice(start, next < 0 ? undefined : next);
  const fence = /```text\n([\s\S]*?)\n```/.exec(section);
  if (!fence?.[1]) throw new Error(`"## ${heading}" in listing.${lang}.md has no text block.`);
  return fence[1];
}
