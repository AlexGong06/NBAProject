// Tests for the front end's only data logic.
//
// Since the browser stopped computing scores, this module is all that stands
// between stored rows and the screen: grouping by day, marking the days the NBA
// did not play, ordering the board, and measuring movement across off days.
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

// ── Days the NBA did not play ──────────────────────────────────────────────
//
// Ten days of the 2025-26 season carry no rows: Thanksgiving, the NBA Cup
// final, Christmas Eve, the six-day All-Star break, and the day before the
// finale. None is a failure to collect — the season is rebuilt in one pass from
// the NBA stats API, so there is no run that could have missed one.
//
// These tests used to be called "days the collector missed" and asserted that
// such a day has no rankings and a null rank in history. That was the old
// nightly-scrape model. The standings on an off day are the standings from the
// last game day, unchanged, because nobody played.
describe("days the NBA did not play", () => {
  const D = buildDataSource(
    [
      row({ date: "3-1-2026", player: "A", mvpValue: 2 }),
      row({ date: "3-1-2026", player: "B", mvpValue: 1 }),
      row({ date: "3-3-2026", player: "A", mvpValue: 1 }),
      row({ date: "3-3-2026", player: "B", mvpValue: 2 }),
    ],
    "test",
  );

  it("keeps off days on the calendar", () => {
    expect(D.DATES.map((d) => d.key)).toEqual([
      "3-1-2026",
      "3-2-2026",
      "3-3-2026",
    ]);
    expect([...D.NO_GAME_DAYS]).toEqual(["3-2-2026"]);
  });

  // `rankings` stays strict — a day with no games has no board of its own, and
  // an empty array would read as "no candidates today", a different and false
  // claim. `standingsFor` is the one that answers the reader's question.
  it("has no board of its own for an off day", () => {
    expect(D.rankings("3-2-2026")).toBeNull();
    expect(D.rankings("3-1-2026")).toHaveLength(2);
  });

  it("serves the previous game day's standings on an off day", () => {
    const s = D.standingsFor("3-2-2026")!;

    expect(s.noGames).toBe(true);
    expect(s.asOf.key).toBe("3-1-2026");
    expect(s.rows.map((r) => r.player)).toEqual(["A", "B"]); // Mar 1 order
  });

  it("reports a game day as itself, not as carried over", () => {
    const s = D.standingsFor("3-3-2026")!;

    expect(s.noGames).toBe(false);
    expect(s.asOf.key).toBe("3-3-2026");
    expect(s.rows.map((r) => r.player)).toEqual(["B", "A"]); // Mar 3 order
  });

  it("resolves an off day to the game day before it", () => {
    expect(D.effectiveDate("3-2-2026")!.key).toBe("3-1-2026");
    expect(D.effectiveDate("3-3-2026")!.key).toBe("3-3-2026");
  });

  // The flat line. This used to assert null, which drew the All-Star break as a
  // six-day hole with a dashed line across it captioned "no scrape".
  it("carries rank and score forward across an off day", () => {
    const points = D.history("A", "3-3-2026", 30);
    const off = points.find((p) => p.noGames)!;

    expect(off.carried).toBe(true);
    expect(off.rank).toBe(1); // his Mar 1 rank, unchanged
    expect(off.score).toBe(2);
  });

  it("gives a player his numbers from the last game day", () => {
    expect(D.rowFor("A", "3-2-2026")!.mvpValue).toBe(2);
  });

  // Movement is measured against the last day that actually had games.
  // Comparing against the calendar-previous day would make every player
  // "unchanged" across every off day.
  it("measures movement across an off day, not against it", () => {
    const day3 = D.rankings("3-3-2026")!;
    const a = day3.find((r) => r.player === "A")!;
    const b = day3.find((r) => r.player === "B")!;

    expect(a.delta).toBe(-1); // was #1 on the 1st, now #2
    expect(b.delta).toBe(1);
  });

  it("offers the nearest days that games were played on", () => {
    expect(D.nearestGameDays("3-2-2026", 2).map((d) => d.key)).toEqual([
      "3-1-2026",
      "3-3-2026",
    ]);
  });
});

// The real shape, not a two-day toy: six consecutive off days, which is what
// the All-Star break is and what made the old rendering look worst.
describe("a six-day break", () => {
  const D = buildDataSource(
    [
      row({ date: "2-12-2026", player: "Star", mvpValue: 2 }),
      row({ date: "2-12-2026", player: "Rival", mvpValue: 1 }),
      row({ date: "2-19-2026", player: "Star", mvpValue: 2.1 }),
      row({ date: "2-19-2026", player: "Rival", mvpValue: 1.1 }),
    ],
    "test",
  );

  it("carries every day of the break, at the pre-break rank", () => {
    const points = D.history("Star", "2-19-2026", 30);
    const broken = points.filter((p) => p.noGames);

    expect(broken).toHaveLength(6); // Feb 13 through Feb 18
    expect(broken.every((p) => p.carried)).toBe(true);
    expect(broken.every((p) => p.rank === 1)).toBe(true);
    expect(broken.every((p) => p.score === 2)).toBe(true);
  });

  // The line has to be continuous for the chart to draw it flat rather than
  // splitting into two segments joined by a dashed connector.
  it("leaves no null in the middle of the season", () => {
    const points = D.history("Star", "2-19-2026", 30);
    expect(points.every((p) => p.rank != null)).toBe(true);
  });

  it("still reports a real off day in the middle of the break", () => {
    const s = D.standingsFor("2-16-2026")!;
    expect(s.noGames).toBe(true);
    expect(s.asOf.key).toBe("2-12-2026");
  });
});

// The distinction carrying forward must not blur: a day with no games belongs
// to the calendar, a player with no row belongs to the player.
describe("a player who has not debuted", () => {
  const D = buildDataSource(
    [
      row({ date: "3-1-2026", player: "Veteran", mvpValue: 2 }),
      row({ date: "3-3-2026", player: "Veteran", mvpValue: 2 }),
      row({ date: "3-3-2026", player: "Rookie", mvpValue: 1 }),
    ],
    "test",
  );

  it("draws nothing before his first game, and does not carry backwards", () => {
    const points = D.history("Rookie", "3-3-2026", 30);
    const byKey = new Map(points.map((p) => [p.date.key, p]));

    // Mar 1: games were played and he was not in them.
    expect(byKey.get("3-1-2026")!.rank).toBeNull();
    expect(byKey.get("3-1-2026")!.carried).toBe(false);

    // Mar 2: no games, but there is still nothing to carry forward.
    expect(byKey.get("3-2-2026")!.noGames).toBe(true);
    expect(byKey.get("3-2-2026")!.rank).toBeNull();
    expect(byKey.get("3-2-2026")!.carried).toBe(false);

    // Mar 3: he plays.
    expect(byKey.get("3-3-2026")!.rank).toBe(2);
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

  // This used to assert the opposite — that a player already on the board needs
  // no request — and that assumption is what produced the bug below. Being in
  // the board means having been in a top N on some date; it does not mean the
  // app holds that player's season.
  it("still fetches the season for a player already on the board", async () => {
    let calls = 0;
    const D = buildDataSource(boardRows, "test", {
      roster,
      fetchPlayerSeason: async () => { calls++; return null; },
    });

    const season = await D.loadPlayerSeason("Star");
    expect(season?.current.player).toBe("Star"); // still answered
    expect(calls).toBe(1);
  });

  // Falls back to the board when the source has nothing deeper, so the offline
  // fixture keeps working rather than reporting every player as missing.
  it("falls back to the board when the season fetch comes back empty", async () => {
    const D = buildDataSource(boardRows, "test", {
      roster,
      fetchPlayerSeason: async () => null,
    });

    const season = await D.loadPlayerSeason("Star");
    expect(season).not.toBeNull();
    expect(season!.current.player).toBe("Star");
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

// ── The one-good-day player ────────────────────────────────────────────────
//
// Gary Payton II reached the top 50 exactly once, on a one-game sample in
// November, and never again. That single row became his entire identity in the
// app: it was the newest row the board held for him, so `findPlayer` returned
// it, `loadPlayerSeason` treated it as his season and never fetched, and the
// profile printed his November rank — a position within a 50-man board — as his
// rank today, beside a chart with one point in it.
//
// Every assertion here is a symptom that shipped.
describe("a player the board saw on only one date", () => {
  const EARLY = "11-16-2025";
  const LATE = "3-1-2026";

  // Two dates of board. He is in the first and absent from the second.
  const boardRows = [
    row({ player: "Contender", date: EARLY, mvpValue: 2.0 }),
    row({ player: "One Good Day", date: EARLY, mvpValue: 1.5, gamesPlayed: 1, teamGamesPlayed: 1 }),
    row({ player: "Contender", date: LATE, mvpValue: 2.2 }),
    row({ player: "Filler", date: LATE, mvpValue: 1.9 }),
  ];

  // What the API actually holds for him: a row on every date, ranked against
  // the whole league rather than against the board.
  const season = [
    { ...row({ player: "One Good Day", date: EARLY, mvpValue: 1.5 }), calculatedRank: 20, delta: 0 },
    { ...row({ player: "One Good Day", date: LATE, mvpValue: 0.31 }), calculatedRank: 337, delta: 0 },
  ];

  const source = () =>
    buildDataSource(boardRows, "test", {
      fetchPlayerSeason: async (name) => (name === "One Good Day" ? season : null),
    });

  it("fetches his season even though the board holds a row for him", async () => {
    const D = source();
    const loaded = await D.loadPlayerSeason("One Good Day");

    expect(loaded).not.toBeNull();
    // The board's newest row for him is the November one, at 1.5. The season's
    // is March, at 0.31 — a very different player.
    expect(loaded!.current.mvpValue).toBe(0.31);
    expect(loaded!.current.calculatedRank).toBe(337);
  });

  it("reports his rank on the date asked for, not the last one the board saw", async () => {
    const D = source();
    await D.loadPlayerSeason("One Good Day");

    expect(D.rowFor("One Good Day", LATE)!.calculatedRank).toBe(337);
    expect(D.rowFor("One Good Day", EARLY)!.calculatedRank).toBe(20);
  });

  // The empty chart. `history` used to defer to the board for anyone who
  // appeared in it at all, which for him meant one point and nulls everywhere
  // else — a chart that renders as a blank grid and reads as "no data".
  //
  // Only the two observed days are asserted. This fixture has rows on exactly
  // those two dates, so every day between them counts as a day with no games
  // and is carried forward — correct, and not what this test is about.
  it("draws his whole season, not the single day the board caught", async () => {
    const D = source();
    await D.loadPlayerSeason("One Good Day");

    const points = D.history("One Good Day", LATE, D.DATES.length);
    const observed = points.filter((h) => h.rank != null && !h.carried);

    expect(observed.map((h) => h.rank)).toEqual([20, 337]);
    // And the line between them is continuous rather than a gap.
    expect(points.every((h) => h.rank != null)).toBe(true);
  });

  it("leaves players the board genuinely covers alone", async () => {
    const D = source();
    await D.loadPlayerSeason("One Good Day");

    // No season to fetch for him, so the board answers — and still correctly.
    expect(D.rowFor("Contender", LATE)!.mvpValue).toBe(2.2);
    expect(D.rowFor("Contender", LATE)!.calculatedRank).toBe(1);
  });

  it("shares one request between concurrent callers", async () => {
    let calls = 0;
    const D = buildDataSource(boardRows, "test", {
      fetchPlayerSeason: async (name) => {
        calls++;
        return name === "One Good Day" ? season : null;
      },
    });

    // Concurrent callers must share one request, not race.
    await Promise.all([
      D.loadPlayerSeason("One Good Day"),
      D.loadPlayerSeason("One Good Day"),
      D.loadPlayerSeason("One Good Day"),
    ]);
    expect(calls).toBe(1);
  });
});

// ── The field around a player ──────────────────────────────────────────────
describe("fieldAround", () => {
  const rows = [
    row({ player: "A", mvpValue: 2.0 }),
    row({ player: "B", mvpValue: 1.8 }),
    row({ player: "C", mvpValue: 1.6 }),
    row({ player: "D", mvpValue: 1.4 }),
    row({ player: "E", mvpValue: 1.2 }),
  ];

  it("prefers the source's window, which is measured against the whole league", async () => {
    const D = buildDataSource(rows, "test", {
      fetchFieldAround: async () => ({
        rank: 337,
        fieldSize: 582,
        complete: true,
        rows: [{ ...row({ player: "C" }), calculatedRank: 337, delta: 0 }],
      }),
    });

    const field = await D.fieldAround("C", "3-1-2026", 10);
    expect(field!.rank).toBe(337);
    expect(field!.fieldSize).toBe(582);
    expect(field!.complete).toBe(true);
  });

  // Without a source that can reach the whole league, the board is all there
  // is. `complete: false` is what stops the UI printing a position among five
  // loaded rows as a rank among 582.
  it("falls back to the board and marks the answer incomplete", async () => {
    const D = buildDataSource(rows, "test");

    const field = await D.fieldAround("C", "3-1-2026", 1);
    expect(field!.complete).toBe(false);
    expect(field!.rank).toBe(3);
    expect(field!.fieldSize).toBe(5);
    expect(field!.rows.map((r) => r.player)).toEqual(["B", "C", "D"]);
  });

  // At the top of the board the window slides down rather than being cut short,
  // so the rail keeps its full height instead of collapsing to three rows for
  // the league leader.
  it("slides the window rather than truncating it at rank 1", async () => {
    const D = buildDataSource(rows, "test");

    const field = await D.fieldAround("A", "3-1-2026", 2);
    expect(field!.rank).toBe(1);
    expect(field!.rows.map((r) => r.player)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("returns null for a player with no row on that date", async () => {
    const D = buildDataSource(rows, "test");

    await expect(D.fieldAround("Nobody", "3-1-2026", 5)).resolves.toBeNull();
  });
});

// ── Loading one date at a time ─────────────────────────────────────────────
//
// The app used to download every row of every date — 11.47 MB — before it drew
// anything, because four different things needed the season: the ribbon, the
// charts, the visible board, and player lookup. Only the board needs full rows,
// and only for one date.
//
// So a source can now supply the calendar and a compact rank series instead,
// and fetch rows per date. These tests pin the two things that split apart.
describe("loading one date at a time", () => {
  const MAR1 = "3-1-2026";
  const MAR3 = "3-3-2026";

  const series = [
    { p: "A", d: MAR1, r: 1, v: 2 },
    { p: "B", d: MAR1, r: 2, v: 1 },
    { p: "A", d: MAR3, r: 2, v: 1 },
    { p: "B", d: MAR3, r: 1, v: 2 },
  ];

  const source = (opts: { onlyLoad?: string } = {}) => {
    const fetched: string[] = [];
    const D = buildDataSource(
      opts.onlyLoad === MAR1
        ? [row({ date: MAR1, player: "A", mvpValue: 2 }), row({ date: MAR1, player: "B", mvpValue: 1 })]
        : [],
      "test",
      {
        calendar: ["2026-03-01", "2026-03-03"],
        series,
        fetchDate: async (dateKey) => {
          fetched.push(dateKey);
          return dateKey === MAR3
            ? [row({ date: MAR3, player: "B", mvpValue: 2 }), row({ date: MAR3, player: "A", mvpValue: 1 })]
            : [row({ date: MAR1, player: "A", mvpValue: 2 }), row({ date: MAR1, player: "B", mvpValue: 1 })];
        },
      },
    );
    return { D, fetched };
  };

  it("builds the calendar without a single row", () => {
    const { D } = source();
    expect(D.DATES.map((d) => d.key)).toEqual([MAR1, "3-2-2026", MAR3]);
    expect([...D.NO_GAME_DAYS]).toEqual(["3-2-2026"]);
  });

  // The whole point of the series: a sparkline covers fourteen dates, of which
  // at most one has its rows in memory.
  it("charts a player across dates whose rows were never fetched", () => {
    const { D } = source();
    const points = D.history("A", MAR3, 30).filter((p) => p.rank != null);
    expect(points.map((p) => p.rank)).toEqual([1, 1, 2]); // Mar 2 carried forward
  });

  it("has no board for a date until it is fetched", async () => {
    const { D, fetched } = source();
    expect(D.isDateLoaded(MAR3)).toBe(false);
    expect(D.standingsFor(MAR3)).toBeNull();

    await D.ensureDate(MAR3);

    expect(fetched).toEqual([MAR3]);
    expect(D.isDateLoaded(MAR3)).toBe(true);
    expect(D.standingsFor(MAR3)!.rows.map((r) => r.player)).toEqual(["B", "A"]);
  });

  // The regression. `ensureDate` skipped any date in NO_GAME_DAYS, so an off
  // day fetched nothing — and its board comes from the previous game day, which
  // therefore had no rows either. The whole All-Star break rendered blank.
  it("fetches the game day an off day inherits from", async () => {
    const { D, fetched } = source();
    await D.ensureDate("3-2-2026");

    expect(fetched).toEqual([MAR1]);
    expect(D.isDateLoaded("3-2-2026")).toBe(true);

    const standings = D.standingsFor("3-2-2026")!;
    expect(standings.noGames).toBe(true);
    expect(standings.asOf.key).toBe(MAR1);
    expect(standings.rows.map((r) => r.player)).toEqual(["A", "B"]);
  });

  it("shares one request between concurrent callers", async () => {
    const { D, fetched } = source();
    await Promise.all([D.ensureDate(MAR3), D.ensureDate(MAR3), D.ensureDate(MAR3)]);
    expect(fetched).toEqual([MAR3]);
  });

  it("measures movement from the series, not from a fetched neighbour", async () => {
    const { D } = source();
    await D.ensureDate(MAR3);

    // Mar 1 was never fetched, yet the delta against it is still known.
    expect(D.isDateLoaded(MAR1)).toBe(false);
    const board = D.standingsFor(MAR3)!.rows;
    expect(board.find((r) => r.player === "B")!.delta).toBe(1); // 2 -> 1
    expect(board.find((r) => r.player === "A")!.delta).toBe(-1);
  });
});
