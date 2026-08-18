// Tests for the front end's only data logic.
//
// Since the browser stopped computing scores, this module is all that stands
// between stored rows and the screen: grouping by day, detecting the days the
// collector missed, ordering the board, and measuring movement across gaps.
//
// Nothing here checks arithmetic — there is none left to check. What it guards
// is the shape of the answer, which is where the failures actually happened.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
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
    gamesPlayed: 54,
    minutesPerGame: 36,
    pointsPerGame: 30,
    assistsPerGame: 10,
    reboundsPerGame: 12,
    blocksPerGame: 1,
    stealsPerGame: 2,
    foulsPerGame: 2,
    turnoversPerGame: 3,
    usageRate: 0.3,
    pie: 0.22,
    netRating: 12,
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
    formulaVersion: 3,
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
  // under one formula could sit beside a score from another.
  //
  // Rank is no longer stored at all, but rows written before that change still
  // carry one — and a stale collection is exactly where a wrong rank comes
  // from. So these rows are given deliberately wrong ranks, as legacy rows
  // would have, and the field must be ignored rather than trusted.
  it("ranks by stored score, ignoring any rank on the row", () => {
    const legacy = (r: StoredRow, calculatedRank: number) =>
      ({ ...r, calculatedRank }) as StoredRow;

    const D = buildDataSource(
      [
        legacy(row({ player: "Low", mvpValue: 0.5 }), 1),
        legacy(row({ player: "High", mvpValue: 2.0 }), 9),
        legacy(row({ player: "Mid", mvpValue: 1.0 }), 5),
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
        row({ player: `p${i}`, mvpValue: v }),
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

// public/rankings.json is generated, not committed — it is 3 MB of minified
// JSON that git cannot delta, so every regeneration would add another 3 MB to
// history forever. Build it with `pnpm generate-fixture`.
//
// These tests therefore skip when it is absent rather than fail: a fresh clone
// has no database and cannot produce it, and a red suite there would say
// "broken" when the truth is "not generated yet".
const FIXTURE_PATH = join(__dirname, "../../public/rankings.json");
const hasFixture = existsSync(FIXTURE_PATH);

describe.skipIf(!hasFixture)("the generated fixture", () => {
  // public/rankings.json is what a fresh clone renders with no database and no
  // network, and it is regenerated by hand whenever the season is rebuilt. That
  // makes it the one input nothing else checks: the type system never sees it
  // (it arrives as `any` from fetch), and a mismatch surfaces only as a blank
  // page in front of whoever was being shown the project.
  //
  // buildDataSource throws on a row missing a breakdown term, so simply running
  // it over the real file is the whole test.
  const fixture: StoredRow[] = hasFixture
    ? JSON.parse(readFileSync(FIXTURE_PATH, "utf8"))
    : [];

  it("is a non-empty set of rows the app accepts", () => {
    expect(fixture.length).toBeGreaterThan(0);
    expect(() => buildDataSource(fixture, "fixture")).not.toThrow();
  });

  it("carries the fields the current formula needs", () => {
    for (const key of ["pie", "netRating", "usageRate", "mvpValue", "availability"] as const) {
      expect(typeof fixture[0][key], key).toBe("number");
    }
    // Stale exports are the failure this catches: a v2 fixture would still
    // parse, still render, and quietly show scores from a retired formula.
    expect(fixture[0].formulaVersion).toBe(3);
  });

  // Usage and PIE are stored as fractions. An export that scaled them to
  // percentages would render "28.8%" as "2880%" and, worse, feed the formula
  // panel numbers that no longer reconcile with the score beside them.
  it("stores rates as fractions, not percentages", () => {
    for (const row of fixture) {
      expect(row.usageRate).toBeLessThan(1);
      expect(row.pie).toBeLessThan(1);
      expect(row.trueShootingPercentage).toBeLessThan(2);
    }
  });

  // The board the app draws must agree with the numbers it prints.
  it("ranks consistently with its own scores", () => {
    const D = buildDataSource(fixture, "fixture");
    const board = D.rankings(D.TODAY_KEY)!;

    expect(board.length).toBeGreaterThan(1);
    expect(board.map((r) => r.calculatedRank)).toEqual(
      board.map((_, i) => i + 1),
    );
    for (let i = 1; i < board.length; i++) {
      expect(board[i - 1].mvpValue).toBeGreaterThanOrEqual(board[i].mvpValue);
    }
  });
});

describe("searching and loading the rest of the league", () => {
  // The board is a top N per date, so most of the league is not in `rows` —
  // only 137 of 582 players reach a top 50 all season. Search used to filter
  // one date's board, which meant about 25 players were reachable and the other
  // 557 were in the database but unreachable from the UI.
  const boardRows = [
    row({ player: "Star", mvpValue: 2.0 }),
    row({ player: "Regular", mvpValue: 1.0 }),
  ];

  const roster = [
    { player: "Star", team: "DEN", pos: "C", pointsPerGame: 30, mvpValue: 2.0, loaded: false },
    { player: "Regular", team: "DEN", pos: "G", pointsPerGame: 20, mvpValue: 1.0, loaded: false },
    { player: "Benchwarmer", team: "MIN", pos: "F", pointsPerGame: 2, mvpValue: 0.05, loaded: false },
  ];

  it("searches the whole roster, not just the loaded board", () => {
    const D = buildDataSource(boardRows, "test", { roster });

    expect(D.ROSTER).toHaveLength(3);
    expect(D.ROSTER.map((r) => r.player)).toContain("Benchwarmer");
  });

  // The UI needs to know which players are already in memory, so it can open
  // their profile without a round trip.
  it("marks which roster entries are already loaded", () => {
    const D = buildDataSource(boardRows, "test", { roster });
    const byName = new Map(D.ROSTER.map((r) => [r.player, r.loaded]));

    expect(byName.get("Star")).toBe(true);
    expect(byName.get("Benchwarmer")).toBe(false);
  });

  // Without a roster — the offline fixture — search still works, over what is
  // actually there. A smaller search, not a broken one.
  it("falls back to the loaded players when no roster is supplied", () => {
    const D = buildDataSource(boardRows, "test");

    expect(D.ROSTER.map((r) => r.player).sort()).toEqual(["Regular", "Star"]);
    expect(D.ROSTER.every((r) => r.loaded)).toBe(true);
  });

  it("answers from memory for a player already on the board", async () => {
    let calls = 0;
    const D = buildDataSource(boardRows, "test", {
      roster,
      fetchPlayerSeason: async () => { calls++; return null; },
    });

    const season = await D.loadPlayerSeason("Star");
    expect(season?.current.player).toBe("Star");
    expect(calls).toBe(0); // no request for someone we already hold
  });

  // The point of the whole feature: a player the board never loaded still gets
  // a real profile.
  it("fetches a player outside the board and exposes his history", async () => {
    const fetchPlayerSeason = async (name: string) =>
      name === "Benchwarmer"
        ? [{ ...row({ player: "Benchwarmer", mvpValue: 0.05 }), calculatedRank: 384, delta: 0 }]
        : null;

    const D = buildDataSource(boardRows, "test", { roster, fetchPlayerSeason });
    const season = await D.loadPlayerSeason("Benchwarmer");

    expect(season).not.toBeNull();
    expect(season!.current.player).toBe("Benchwarmer");
    expect(season!.current.calculatedRank).toBe(384);

    // And once fetched, the ordinary history path serves him — which is what
    // makes the charts work without knowing he arrived late.
    const hist = D.history("Benchwarmer", D.TODAY_KEY, 30).filter((h) => h.rank != null);
    expect(hist.length).toBeGreaterThan(0);
    expect(hist.at(-1)!.rank).toBe(384);
  });

  it("does not refetch a season it already has", async () => {
    let calls = 0;
    const D = buildDataSource(boardRows, "test", {
      roster,
      fetchPlayerSeason: async () => {
        calls++;
        return [{ ...row({ player: "Benchwarmer" }), calculatedRank: 384, delta: 0 }];
      },
    });

    await D.loadPlayerSeason("Benchwarmer");
    await D.loadPlayerSeason("Benchwarmer");
    expect(calls).toBe(1);
  });

  // Fixture mode has no API behind it. A search hit with no profile must
  // resolve null so the UI can say so, rather than throwing or rendering
  // someone else's numbers.
  it("returns null for an unreachable player instead of throwing", async () => {
    const D = buildDataSource(boardRows, "test", { roster });

    await expect(D.loadPlayerSeason("Benchwarmer")).resolves.toBeNull();
  });
});
