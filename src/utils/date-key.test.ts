// Tests for the "M-D-YYYY" date key.
//
// The key is the join between three things that never meet in code: the
// scraper writing a row, Mongo indexing it, and the front end asking for a
// calendar day. If any of them disagrees about what a key means, the app shows
// the wrong day's rankings with no error anywhere. These tests pin the format
// and, more importantly, pin the ordering — see the "chronological ordering"
// block, which is the one that was actually broken in production code.

import { describe, expect, it } from "vitest";
import {
  byDateKeyDescending,
  compareDateKeys,
  isDateKey,
  parseDateKey,
  toDateKey,
} from "./date-key";

describe("toDateKey", () => {
  // Guards against someone "tidying" the format to ISO or to zero-padded
  // M/D. Every key already in MongoDB is unpadded; changing the emitted shape
  // orphans all existing rows, because lookups are exact string matches.
  it("emits month and day without zero padding", () => {
    expect(toDateKey(new Date(2026, 1, 5))).toBe("2-5-2026");
    expect(toDateKey(new Date(2026, 0, 1))).toBe("1-1-2026");
  });

  // Guards against an off-by-one from JavaScript's zero-indexed months, the
  // single most common bug in this format. December must be 12, not 11.
  it("uses one-indexed months", () => {
    expect(toDateKey(new Date(2026, 11, 25))).toBe("12-25-2026");
  });

  // Guards against a future refactor to UTC accessors. The scraper runs at
  // 04:00 UTC, which is the previous evening in US timezones, so getUTCDate()
  // and getDate() disagree about which day a run belongs to. Whichever is
  // chosen has to stay chosen or historical keys stop lining up.
  it("reads local calendar fields, not UTC", () => {
    const lateEvening = new Date(2026, 1, 17, 23, 30);
    expect(toDateKey(lateEvening)).toBe("2-17-2026");
  });
});

describe("parseDateKey", () => {
  // The basic contract: a key names the day it says it names, at local
  // midnight. Guards against new Date("2-17-2026"), which some engines read as
  // UTC and hand back the 16th in any timezone west of Greenwich.
  it("returns local midnight for a well-formed key", () => {
    const parsed = parseDateKey("2-17-2026");
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(1);
    expect(parsed!.getDate()).toBe(17);
    expect(parsed!.getHours()).toBe(0);
  });

  // Round-tripping is what lets the front end build a continuous calendar
  // between the first and last day it sees. If parse and format disagree
  // anywhere, gap detection invents missing days that were never missing.
  it("round-trips with toDateKey", () => {
    for (const key of ["1-1-2026", "2-5-2026", "6-30-2026", "12-31-2026"]) {
      expect(toDateKey(parseDateKey(key)!)).toBe(key);
    }
  });

  // Padded input is accepted so a hand-typed URL or an older row still
  // resolves, but the canonical output stays unpadded. Guards against the
  // parser being tightened to exact-match the emitted format, which would
  // start 404ing requests that used to work.
  it("accepts zero-padded input and normalises it", () => {
    expect(toDateKey(parseDateKey("02-05-2026")!)).toBe("2-5-2026");
  });

  // The important rejection. new Date(2026, 1, 30) silently becomes March 2nd.
  // Without the round-trip check in parseDateKey, a typo'd date would return a
  // real Date for a day that does not exist and quietly query the wrong one.
  it("rejects impossible calendar dates instead of rolling over", () => {
    expect(parseDateKey("2-30-2026")).toBeNull();
    expect(parseDateKey("13-1-2026")).toBeNull();
    expect(parseDateKey("4-31-2026")).toBeNull();
  });

  // Feb 29 exists in 2028 and does not in 2026. Guards a naive
  // days-in-month table that forgets leap years.
  it("handles leap years", () => {
    expect(parseDateKey("2-29-2028")).not.toBeNull();
    expect(parseDateKey("2-29-2026")).toBeNull();
  });

  // Guards against a loose regex. ISO input is the likeliest thing to get
  // passed in by mistake, and it must not half-parse into something plausible.
  it("rejects malformed input", () => {
    for (const bad of ["", "2026-02-17", "2/17/2026", "2-17", "abc", "2-17-26"]) {
      expect(parseDateKey(bad)).toBeNull();
    }
  });
});

describe("isDateKey", () => {
  it("agrees with parseDateKey", () => {
    expect(isDateKey("2-17-2026")).toBe(true);
    expect(isDateKey("2-30-2026")).toBe(false);
  });
});

describe("chronological ordering", () => {
  // This is the block that matters.
  //
  // The API used to order rows with Mongo's .sort({ date: -1 }), which sorts
  // "M-D-YYYY" as text. Under byte comparison "9-1-2025" beats "2-17-2026"
  // beats "12-1-2026" — so the route documented as "newest first" returned an
  // order with no relationship to time. Every assertion below fails against a
  // lexicographic sort.

  // Single vs double digit months: "9" > "12" as text, 9 < 12 as a month.
  it("orders single-digit months before double-digit ones", () => {
    expect(compareDateKeys("9-1-2026", "12-1-2026")).toBeLessThan(0);
  });

  // Same trap one level down, on the day.
  it("orders single-digit days before double-digit ones", () => {
    expect(compareDateKeys("2-9-2026", "2-17-2026")).toBeLessThan(0);
  });

  // Text sort keys on the leading month, so an earlier month in a later year
  // wins. This is the case that silently reorders a season that spans a new
  // year, which every NBA season does.
  it("orders across a year boundary", () => {
    expect(compareDateKeys("12-31-2025", "1-1-2026")).toBeLessThan(0);
    expect(compareDateKeys("9-1-2025", "2-17-2026")).toBeLessThan(0);
  });

  it("reports equal keys as equal", () => {
    expect(compareDateKeys("2-17-2026", "2-17-2026")).toBe(0);
  });

  // A malformed key should degrade the ordering, not take down the request.
  // Guards against a future version that throws on unparseable input, which
  // would turn one bad row into a 500 for the whole list endpoint.
  it("sorts unparseable keys last without throwing", () => {
    expect(() => compareDateKeys("garbage", "2-17-2026")).not.toThrow();
    expect(compareDateKeys("garbage", "2-17-2026")).toBeGreaterThan(0);
    expect(compareDateKeys("garbage", "also-garbage")).toBe(0);
  });
});

describe("byDateKeyDescending", () => {
  // The end-to-end version of the bug: a realistic slice of a season, in the
  // order a lexicographic sort would produce, must come back newest-first.
  it("returns rows newest first across months and years", () => {
    const rows = [
      { date: "12-1-2025", player: "a" },
      { date: "1-15-2026", player: "b" },
      { date: "9-30-2025", player: "c" },
      { date: "2-17-2026", player: "d" },
      { date: "10-8-2025", player: "e" },
    ];

    expect(byDateKeyDescending(rows).map((r) => r.date)).toEqual([
      "2-17-2026",
      "1-15-2026",
      "12-1-2025",
      "10-8-2025",
      "9-30-2025",
    ]);
  });

  // Eight players share one date. Their relative order is set by the ranking
  // logic upstream, and re-sorting by date must not disturb it — otherwise the
  // leaderboard shuffles between requests for reasons nobody can reproduce.
  it("is stable within a single date", () => {
    const rows = [
      { date: "2-17-2026", player: "first" },
      { date: "2-17-2026", player: "second" },
      { date: "2-17-2026", player: "third" },
    ];

    expect(byDateKeyDescending(rows).map((r) => r.player)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  // Guards against an in-place .sort() on the caller's array. The route hands
  // this the result of .toArray(); mutating shared state is the kind of thing
  // that only shows up under concurrent requests.
  it("does not mutate its input", () => {
    const rows = [{ date: "1-1-2026" }, { date: "2-1-2026" }];
    byDateKeyDescending(rows);
    expect(rows.map((r) => r.date)).toEqual(["1-1-2026", "2-1-2026"]);
  });
});
