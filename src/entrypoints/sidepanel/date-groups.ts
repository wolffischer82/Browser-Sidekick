/** The drawer's date groups (redesign spec 5.6), in display order. */
export type DateGroup = 'today' | 'thisWeek' | 'earlier';

const ORDER: readonly DateGroup[] = ['today', 'thisWeek', 'earlier'];

export interface DateGroupItems<T> {
  group: DateGroup;
  items: T[];
}

/** Local midnight at the start of `now`'s day. */
function startOfDay(now: number): Date {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * The group of a time `then` seen from `now`, both in milliseconds, in local
 * time: since midnight today is "today"; earlier in the calendar week, which
 * starts on Monday, is "thisWeek"; anything before is "earlier". A time in
 * the future counts as today.
 */
export function dateGroup(then: number, now: number): DateGroup {
  const today = startOfDay(now);
  if (then >= today.getTime()) return 'today';
  const weekStart = new Date(today);
  // getDay(): Sunday 0 … Saturday 6; days since Monday: Monday 0 … Sunday 6.
  // setDate keeps local midnight across a daylight-saving change.
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return then >= weekStart.getTime() ? 'thisWeek' : 'earlier';
}

/**
 * Splits `items` into the date groups by `time(item)`, keeping their order
 * within each group. Empty groups are left out.
 */
export function groupByDate<T>(
  items: readonly T[],
  time: (item: T) => number,
  now: number,
): DateGroupItems<T>[] {
  const byGroup = new Map<DateGroup, T[]>();
  for (const item of items) {
    const group = dateGroup(time(item), now);
    const list = byGroup.get(group);
    if (list) list.push(item);
    else byGroup.set(group, [item]);
  }
  return ORDER.flatMap((group) => {
    const list = byGroup.get(group);
    return list ? [{ group, items: list }] : [];
  });
}
