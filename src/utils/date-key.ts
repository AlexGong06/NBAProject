// Date keys.
//
// Every ranking row is stored under a date string of the form "M-D-YYYY" —
// unpadded, e.g. "2-5-2026" and "12-25-2026". That format is the DB query key
// and the front end's calendar key, so it is a contract, not a display choice.
//
// It is also unsortable as text. "9-1-2025" > "2-17-2026" > "12-1-2026" under
// byte comparison, which is why anything ordering by date has to parse first
// rather than lean on a lexicographic sort.

/** Format a Date as the "M-D-YYYY" key used throughout the app. */
export function toDateKey(date: Date): string {
  return `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;
}

/**
 * Parse a "M-D-YYYY" key back into a local-midnight Date.
 *
 * Lenient about zero padding on input ("02-05-2026" parses) but `toDateKey`
 * always emits the unpadded form. Returns null for anything that is not a real
 * calendar date, so callers can decide what to do rather than getting an
 * Invalid Date that silently poisons arithmetic.
 */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(key);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  // Build from components rather than new Date(string): the string form is
  // parsed differently across engines and can shift by a day across timezones.
  const date = new Date(year, month - 1, day);

  // Rolls over on impossible dates — new Date(2026, 1, 30) is March 2nd — so
  // compare the parts back to reject "2-30-2026" instead of accepting a
  // silently different day.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

/** True if `key` is a well-formed "M-D-YYYY" naming a real calendar date. */
export function isDateKey(key: string): boolean {
  return parseDateKey(key) !== null;
}

/**
 * Chronological comparator for date keys. Negative when `a` is earlier.
 *
 * Unparseable keys sort to the end rather than throwing: one malformed row in
 * the collection should not turn a list request into a 500.
 */
export function compareDateKeys(a: string, b: string): number {
  const left = parseDateKey(a);
  const right = parseDateKey(b);

  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  return left.getTime() - right.getTime();
}

/** Sort newest first. Use for anything the API hands back as a list. */
export function byDateKeyDescending<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareDateKeys(b.date, a.date));
}
