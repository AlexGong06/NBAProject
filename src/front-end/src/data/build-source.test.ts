// Tests for the front end's only data logic.
//
// Since the browser stopped computing scores, this module is all that stands
// between stored rows and the screen: grouping by day, detecting the days the
// collector missed, ordering the board, and measuring movement across gaps.
//
// Nothing here checks arithmetic — there is none left to check. What it guards
// is the shape of the answer, which is where the failures actually happened.

import { describe, expect, it } from "vitest";
import { buildDataSource } from "./build-source";
import type { StoredRow } from "./types";

/** A complete stored row. Only the fields a test varies are worth reading. */
function row(over: Partial<StoredRow> = {}): StoredRow {
  const mvpValue = over.mvpValue ?? 1;
  return {
    date: "3-1-2026",
    player: "Test Player",
    team: "DEN",
    pos: "C",
    age: 30,
    teamWins: 38,
    teamLosses: 17,
    teamGamesPlayed: 55,
    gamesStarted: 54,
    gamesPlayed: 54,
    minutesPerGame: 36,
    pointsPerGame: 30,
    assistsPerGame: 10,
    reboundsPerGame: 12,
    blocksPerGame: 1,
    stealsPerGame: 2,
    foulsPerGame: 2,
    turnoversPerGame: 3,
    usageRate: 30,
    valueOverReplacement: 6,
    winShare: 10,
    boxPlusMinus: 12,
    trueShootingPercentage: 0.66,
    teamWinRatio: 0.69,
    availability: 0.98,
    minutesFactor: 0.75,
    usageFactor: 0.3,
    levelOfImpact: 0.155,
    qualityOfImpact: 8.8,
    winContribution: 1.36,
    totalStats: 2.1,
    rawValue: mvpValue / 0.98,
    mvpValue,
    calculatedRank: 1,
    formulaVersion: 2,
    ...over,
  };
}

describe("refusing data it cannot render", () => {
  // The front end no longer recalculates, so a row without the stored breakdown
  // has nothing to show. Rendering it would scatter blanks and NaNs through a
  // board that otherwise looks fine — silent wrongness, which is the one
  // failure mode this project is built to avoid.
  it("throws a message naming the missing terms", () => {
    const incomplete = row();
    delete (incomplete as Partial<StoredRow>).winContribution;
    delete (incomplete as Partial<StoredRow>).availability;

    expect(() => buildDataSource([incomplete], "The API")).toThrowError(
      /winContribution.*availability|availability.*winContribution/s,
    );
  });

  // The message has to say what to do about it, since the fix is a migration
  // and not something a reader would guess from "missing field".
  it("tells the reader how to fix it", () => {
    const incomplete = row();
    delete (incomplete as Partial<StoredRow>).mvpValue;

    expect(() => buildDataSource([incomplete], "The API")).toThrowError(
      /migration|fixture/i,
    );
  });

  it("throws on an empty result rather than rendering an empty board", () => {
    expect(() => buildDataSource([], "The API")).toThrowError(
      /no ranking rows/i,
    );
  });
});

describe("days the collector missed", () => {
  // Two days of data three days apart: the day between them was a failure, not
  // an absence of candidates, and it has to stay on the timeline.
  const D = buildDataSource(
    [
      row({ date: "3-1-2026", player: "A", mvpValue: 2 }),
      row({ date: "3-1-2026", player: "B", mvpValue: 1 }),
      row({ date: "3-3-2026", player: "A", mvpValue: 1 }),
      row({ date: "3-3-2026", player: "B", mvpValue: 2 }),
    ],
    "test",
  );

  it("keeps missing days on the calendar", () => {
    expect(D.DATES.map((d) => d.key)).toEqual([
      "3-1-2026",
      "3-2-2026",
      "3-3-2026",
    ]);
    expect([...D.MISSING]).toEqual(["3-2-2026"]);
  });

  // null, never []. An empty array reads as "no candidates today", which is a
  // different and false claim.
  it("returns null for a missing day, not an empty list", () => {
    expect(D.rankings("3-2-2026")).toBeNull();
    expect(D.rankings("3-1-2026")).toHaveLength(2);
  });

  it("reports gaps in history with null rank and score", () => {
    const points = D.history("A", "3-3-2026", 30);
    const gap = points.find((p) => p.missing);

    expect(gap).toBeDefined();
    expect(gap!.rank).toBeNull();
    expect(gap!.score).toBeNull();
  });

  // Movement is measured against the last day that actually has data. Comparing
  // against the calendar-previous day would make every player "unchanged"
  // whenever a scrape failed.
  it("measures movement across a gap, not against it", () => {
    const day3 = D.rankings("3-3-2026")!;
    const a = day3.find((r) => r.player === "A")!;
    const b = day3.find((r) => r.player === "B")!;

    expect(a.delta).toBe(-1); // was #1 on the 1st, now #2
    expect(b.delta).toBe(1);
  });

  it("offers the nearest days that do have data", () => {
    expect(D.nearestWithData("3-2-2026", 2).map((d) => d.key)).toEqual([
      "3-1-2026",
      "3-3-2026",
    ]);
  });
});

describe("ranking", () => {
  // The regression. api.ts used to prefer the calculatedRank that arrived on
  // the row over the position it had just sorted into, so a badge computed
  // under one formula could sit beside a score from another. The stored rank is
  // deliberately wrong here.
  it("ranks by stored score, ignoring any rank on the row", () => {
    const D = buildDataSource(
      [
        row({ player: "Low", mvpValue: 0.5, calculatedRank: 1 }),
        row({ player: "High", mvpValue: 2.0, calculatedRank: 9 }),
        row({ player: "Mid", mvpValue: 1.0, calculatedRank: 5 }),
      ],
      "test",
    );

    const rows = D.rankings("3-1-2026")!;
    expect(rows.map((r) => r.player)).toEqual(["High", "Mid", "Low"]);
    expect(rows.map((r) => r.calculatedRank)).toEqual([1, 2, 3]);
  });

  // A board whose positions disagree with its own numbers is the exact defect
  // that started all of this, so assert the invariant directly.
  it("never places a lower score above a higher one", () => {
    const D = buildDataSource(
      [0.7, 2.2, 1.4, 0.1, 1.9].map((v, i) =>
        row({ player: `p${i}`, mvpValue: v, calculatedRank: 1 }),
      ),
      "test",
    );

    const scores = D.rankings("3-1-2026")!.map((r) => r.mvpValue);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe("PLAYERS", () => {
  const D = buildDataSource(
    [
      row({ date: "3-1-2026", player: "Older", mvpValue: 9 }),
      row({ date: "3-2-2026", player: "A", mvpValue: 1 }),
      row({ date: "3-2-2026", player: "B", mvpValue: 2 }),
    ],
    "test",
  );

  // Every entry carries a full breakdown, because the formula panel reads it
  // straight off the player rather than looking anything up.
  it("carries the breakdown on each player", () => {
    for (const p of D.PLAYERS) {
      expect(typeof p.winContribution).toBe("number");
      expect(typeof p.availability).toBe("number");
    }
  });

  it("is ordered by current score", () => {
    expect(D.PLAYERS.map((p) => p.player)).toEqual(["Older", "B", "A"]);
  });

  // Someone who has dropped out of the tracked set still resolves, so an old
  // bookmarked profile URL does not 404.
  it("keeps players last seen on an earlier day", () => {
    expect(D.findPlayer("Older")).toBeDefined();
    expect(D.findPlayer("Nobody")).toBeUndefined();
  });
});
