import { describe, expect, it } from 'vitest';
import { dateGroup, groupByDate } from '@/entrypoints/sidepanel/date-groups';

// Local-time constructors, so the tests hold in any time zone.
const at = (day: number, hour = 12, minute = 0, second = 0, ms = 0) =>
  new Date(2026, 9, day, hour, minute, second, ms).getTime();

// October 2026: Monday the 5th, Wednesday the 7th, Sunday the 11th.
const WEDNESDAY_NOON = at(7);

describe('dateGroup', () => {
  it('puts anything since local midnight in today', () => {
    expect(dateGroup(at(7, 0, 0), WEDNESDAY_NOON)).toBe('today');
    expect(dateGroup(at(7, 11, 59), WEDNESDAY_NOON)).toBe('today');
    expect(dateGroup(WEDNESDAY_NOON, WEDNESDAY_NOON)).toBe('today');
  });

  it('puts the moment before local midnight in this week', () => {
    expect(dateGroup(at(7, 0, 0) - 1, WEDNESDAY_NOON)).toBe('thisWeek');
    expect(dateGroup(at(6, 23, 59, 59, 999), WEDNESDAY_NOON)).toBe('thisWeek');
  });

  it('starts the week on Monday at local midnight', () => {
    expect(dateGroup(at(5, 0, 0), WEDNESDAY_NOON)).toBe('thisWeek');
    expect(dateGroup(at(5, 0, 0) - 1, WEDNESDAY_NOON)).toBe('earlier');
    expect(dateGroup(at(4, 18), WEDNESDAY_NOON)).toBe('earlier');
  });

  it('has no this-week part on a Monday', () => {
    const mondayMorning = at(5, 0, 30);
    expect(dateGroup(at(5, 0, 0), mondayMorning)).toBe('today');
    expect(dateGroup(at(4, 23, 59), mondayMorning)).toBe('earlier');
  });

  it('counts the whole week up to Sunday night', () => {
    const sundayLate = at(11, 23, 59);
    expect(dateGroup(at(11, 0, 0), sundayLate)).toBe('today');
    expect(dateGroup(at(10, 23, 59), sundayLate)).toBe('thisWeek');
    expect(dateGroup(at(5, 0, 0), sundayLate)).toBe('thisWeek');
    expect(dateGroup(at(4, 23, 59), sundayLate)).toBe('earlier');
  });

  it('turns over at local midnight', () => {
    const justAfterMidnight = at(8, 0, 0, 0, 1);
    expect(dateGroup(at(7, 23, 59), justAfterMidnight)).toBe('thisWeek');
    expect(dateGroup(at(8, 0, 0), justAfterMidnight)).toBe('today');
  });

  it('puts a time in the future in today', () => {
    expect(dateGroup(WEDNESDAY_NOON + 60_000, WEDNESDAY_NOON)).toBe('today');
  });

  it('keeps local midnight across a daylight-saving change', () => {
    // Central Europe moves its clocks on Sunday 29 March and 25 October 2026.
    const sunday = new Date(2026, 2, 29, 12).getTime();
    expect(dateGroup(new Date(2026, 2, 29, 0, 0).getTime(), sunday)).toBe('today');
    expect(dateGroup(new Date(2026, 2, 23, 0, 0).getTime(), sunday)).toBe('thisWeek');
    expect(dateGroup(new Date(2026, 2, 22, 23, 59).getTime(), sunday)).toBe('earlier');
    const monday = new Date(2026, 9, 26, 0, 30).getTime();
    expect(dateGroup(new Date(2026, 9, 26, 0, 0).getTime(), monday)).toBe('today');
    expect(dateGroup(new Date(2026, 9, 25, 23, 59).getTime(), monday)).toBe('earlier');
  });

  it('crosses a month boundary', () => {
    // Thursday 1 October 2026: the week started on Monday 28 September.
    const thursday = new Date(2026, 9, 1, 9).getTime();
    expect(dateGroup(new Date(2026, 8, 28, 0, 0).getTime(), thursday)).toBe('thisWeek');
    expect(dateGroup(new Date(2026, 8, 27, 23, 59).getTime(), thursday)).toBe('earlier');
  });
});

describe('groupByDate', () => {
  const item = (name: string, time: number) => ({ name, time });

  it('keeps the order within each group and the groups in order', () => {
    const items = [
      item('a', at(7, 11)),
      item('b', at(7, 1)),
      item('c', at(6, 9)),
      item('d', at(5, 9)),
      item('e', at(1)),
      item('f', at(1) - 86_400_000 * 40),
    ];
    const groups = groupByDate(items, (i) => i.time, WEDNESDAY_NOON);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.name)])).toEqual([
      ['today', ['a', 'b']],
      ['thisWeek', ['c', 'd']],
      ['earlier', ['e', 'f']],
    ]);
  });

  it('leaves out empty groups', () => {
    const groups = groupByDate(
      [item('a', at(1)), item('b', at(7, 8))],
      (i) => i.time,
      WEDNESDAY_NOON,
    );
    expect(groups.map((g) => g.group)).toEqual(['today', 'earlier']);
    expect(groups[0]?.items.map((i) => i.name)).toEqual(['b']);
  });

  it('returns no groups for no items', () => {
    expect(groupByDate([], () => 0, WEDNESDAY_NOON)).toEqual([]);
  });
});
