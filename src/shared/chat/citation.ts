/**
 * Citation numbers (spec 5.6, D13; redesign spec 5.2). The pages of a
 * request are numbered in the order pins, then the current tab: a pin is
 * cited with its position in pin order, from 1, whether or not its text is
 * sent, and the current tab with the number after the last pin. The Session
 * tabs list and the context assembly both number from here, so the numbers
 * shown on the rows are the ones the model receives.
 */

/** The citation number of the pin at `position` (0-based) in pin order. */
export function citationNumber(position: number): number {
  return position + 1;
}

/** The current tab's citation number, after all `pinCount` pins. */
export function currentTabCitationNumber(pinCount: number): number {
  return citationNumber(pinCount);
}
