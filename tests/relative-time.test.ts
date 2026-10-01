import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '@/entrypoints/sidepanel/relative-time';

const MIN = 60_000;
const now = 1_700_000_000_000;

describe('formatRelativeTime', () => {
  it.each([
    [0, 'en', 'now'],
    [30_000, 'en', 'now'],
    [-5 * MIN, 'en', 'now'],
    [5 * MIN, 'en', '5 minutes ago'],
    [2 * 60 * MIN, 'en', '2 hours ago'],
    [24 * 60 * MIN, 'en', 'yesterday'],
    [3 * 24 * 60 * MIN, 'en', '3 days ago'],
    [14 * 24 * 60 * MIN, 'en', '2 weeks ago'],
    [400 * 24 * 60 * MIN, 'en', 'last year'],
    [5 * MIN, 'de', 'vor 5 Minuten'],
    [24 * 60 * MIN, 'de', 'gestern'],
  ])('%i ms ago in %s is "%s"', (ago, locale, expected) => {
    expect(formatRelativeTime(now - ago, now, locale)).toBe(expected);
  });
});
