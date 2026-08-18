// Tests for rolling season-to-date aggregation.
//
// This is the highest-risk code in the ingestion path, and the risk is specific:
// using the wrong denominator produces a leaderboard that looks completely
// normal. Nothing crashes, nothing is out of range, the right players are near
// the top — the numbers are just quietly wrong.
//
// So every test here is built around a lopsided pair of games: one long, one a
// two-minute cameo with an extreme rate. Correct weighting buries the cameo;
// simple averaging lets it dominate. The two answers are far apart by
// construction, which is the only way this class of bug fails a test at all.

import { describe, expect, it } from "vitest";
import {
  gameDates,
  indexPlayerGames,
  indexTeamGames,
  seasonToDate,
  teamContextAsOf,
} from "./season-to-date";
import type { PlayerGame, TeamGame } from "./fetch-season";

function game(overrides: Partial<PlayerGame> = {}): PlayerGame {
  return {
    playerId: 1,
    playerName: "Test Player",
    teamId: 100,
    teamAbbr: "AAA",
    gameId: "0000001",
    date: "2025-10-21",
    won: true,
    minutes: 36,
    possessions: 100,
    pie: 0.2,
    usageRate: 0.3,
    trueShootingPercentage: 0.6,
    netRating: 10,
    offensiveRating: 120,
    defensiveRating: 110,
    points: 30,
    assists: 8,
    rebounds: 10,
    blocks: 1,
    steals: 1,
    fouls: 2,
    turnovers: 3,
    fieldGoalAttempts: 20,
    freeThrowAttempts: 10,
    ...overrides,
  };
}

function teamGame(overrides: Partial<TeamGame> = {}): TeamGame {
  return { teamId: 100, teamAbbr: "AAA", gameId: "0000001", date: "2025-10-21", won: true, ...overrides };
}

/**
 * A long game and a garbage-time cameo. The cameo's rates are the kind the API
 * genuinely returns — a single-game PIE of -1.0 and a net rating of -200 are
 * real when the denominator is almost nothing.
 */
const STARTER = game({
  gameId: "G1", date: "2025-10-21",
  minutes: 40, possessions: 100,
  pie: 0.2, usageRate: 0.3, netRating: 10,
  points: 30, fieldGoalAttempts: 20, freeThrowAttempts: 10,
});
const CAMEO = game({
  gameId: "G2", date: "2025-10-23",
  minutes: 5, possessions: 10,
  pie: -1.0, usageRate: 0.05, netRating: -200,
  points: 2, fieldGoalAttempts: 1, freeThrowAttempts: 0,
});

const TEAM_GAMES = indexTeamGames([
  teamGame({ gameId: "G1", date: "2025-10-21", won: true }),
  teamGame({ gameId: "G2", date: "2025-10-23", won: false }),
]);

describe("seasonToDate weighting", () => {
  // PIE is weighted by MINUTES. Averaging the two per-game values gives -0.40 —
  // a number that would make a productive player look like the worst in the
  // league off the back of five garbage-time minutes.
  it("weights PIE by minutes, not by game count", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-23")!;

    expect(s.pie).toBeCloseTo((0.2 * 40 + -1.0 * 5) / 45, 12); // 0.0667
    expect(s.pie).not.toBeCloseTo((0.2 + -1.0) / 2, 3); // -0.40, the wrong answer
  });

  // Usage is also minute-weighted.
  it("weights usage by minutes", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-23")!;

    expect(s.usageRate).toBeCloseTo((0.3 * 40 + 0.05 * 5) / 45, 12); // 0.2722
    expect(s.usageRate).not.toBeCloseTo((0.3 + 0.05) / 2, 3); // 0.175
  });

  // Net rating is weighted by POSSESSIONS, not minutes — it is defined per 100
  // possessions, and possessions are what it was measured over. Using minutes
  // here is the subtlest version of this bug, because the two weights correlate
  // strongly and the answer is only slightly wrong.
  it("weights net rating by possessions, not minutes", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-23")!;

    const byPossessions = (10 * 100 + -200 * 10) / 110; // -9.09
    const byMinutes = (10 * 40 + -200 * 5) / 45; // -13.33
    const byAverage = (10 + -200) / 2; // -95

    expect(s.netRating).toBeCloseTo(byPossessions, 12);
    expect(s.netRating).not.toBeCloseTo(byMinutes, 2);
    expect(s.netRating).not.toBeCloseTo(byAverage, 2);
  });

  // True shooting is recomputed from season TOTALS, never averaged. The cameo
  // is a single made free throw — a per-game TS% of 100%, which averaged would
  // lift a 61% shooter to 81%.
  it("recomputes true shooting from season totals", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-23")!;

    const totalPoints = 32;
    const shootingPossessions = 20 + 0.44 * 10 + 1 + 0.44 * 0; // 25.4
    expect(s.trueShootingPercentage).toBeCloseTo(
      totalPoints / (2 * shootingPossessions), 12,
    ); // 0.6299

    const averaged = (30 / (2 * 24.4) + 2 / (2 * 1)) / 2; // 0.807
    expect(s.trueShootingPercentage).not.toBeCloseTo(averaged, 2);
  });

  // The 0.44 coefficient on free throw attempts is the standard estimate of how
  // many possessions a trip to the line consumes. Dropping it — using bare FTA —
  // understates the denominator and inflates every scorer's efficiency.
  it("applies the 0.44 free throw coefficient", () => {
    const s = seasonToDate([STARTER], TEAM_GAMES, "2025-10-21")!;

    expect(s.trueShootingPercentage).toBeCloseTo(30 / (2 * (20 + 0.44 * 10)), 12);
    expect(s.trueShootingPercentage).not.toBeCloseTo(30 / (2 * (20 + 10)), 3);
  });

  // Box score counting stats ARE per-game averages — games is the right
  // denominator for these, and only these.
  it("averages box score stats per game", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-23")!;

    expect(s.gamesPlayed).toBe(2);
    expect(s.pointsPerGame).toBeCloseTo(32 / 2, 12);
    expect(s.minutesPerGame).toBeCloseTo(45 / 2, 12);
    expect(s.assistsPerGame).toBeCloseTo(16 / 2, 12);
  });

  // A single game must aggregate to exactly its own values. Guards the trivial
  // case, where an off-by-one in a loop bound is easiest to miss.
  it("returns a single game's own values unchanged", () => {
    const s = seasonToDate([STARTER], TEAM_GAMES, "2025-10-21")!;

    expect(s.pie).toBeCloseTo(0.2, 12);
    expect(s.usageRate).toBeCloseTo(0.3, 12);
    expect(s.netRating).toBeCloseTo(10, 12);
  });
});

describe("seasonToDate windowing", () => {
  // The season is rebuilt date by date, so "as of" has to mean "including this
  // date". An exclusive bound silently drops the most recent game at every
  // checkpoint — the single most likely off-by-one in the whole pipeline.
  it("includes games played on the cutoff date itself", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-23")!;
    expect(s.gamesPlayed).toBe(2);
  });

  it("excludes games after the cutoff date", () => {
    const s = seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-21")!;
    expect(s.gamesPlayed).toBe(1);
    expect(s.pie).toBeCloseTo(0.2, 12);
  });

  // Before a player's debut there is no average to report. Returning zeroes
  // would put him on the board with a real-looking score of 0 rather than
  // leaving him off it.
  it("returns null before the player's first game", () => {
    expect(seasonToDate([STARTER, CAMEO], TEAM_GAMES, "2025-10-20")).toBeNull();
  });
});

describe("implausible PIE values", () => {
  // The real case: Joan Beringer, 2025-10-24, PIE of -11.0 in 4.8 minutes with
  // 2 points and 4 rebounds. PIE is a share of the game's total events and
  // cannot honestly leave [-1, 1]; -11 is a collapsed denominator. Minute
  // weighting alone did not absorb it — his season PIE was still below -0.85
  // after thirteen games, which would have ranked him last in the league on a
  // number that was never real.
  const ARTIFACT = game({
    gameId: "BAD", date: "2025-10-24",
    minutes: 4.8, possessions: 9, pie: -11, usageRate: 0.091, netRating: 55.6,
    points: 2, rebounds: 4,
  });

  it("excludes an impossible PIE from the season average", () => {
    const s = seasonToDate([STARTER, ARTIFACT], TEAM_GAMES, "2025-10-24")!;

    // Only the good game contributes, so the average is exactly its value.
    expect(s.pie).toBeCloseTo(0.2, 12);
  });

  // The subtle half of the fix. Excluding the game from the numerator but
  // leaving its minutes in the denominator would drag the average toward zero
  // in proportion to how much was thrown away — 0.2 would become 0.178 here,
  // wrong in a way no range check would ever catch.
  it("excludes the discarded game's minutes from the denominator too", () => {
    const s = seasonToDate([STARTER, ARTIFACT], TEAM_GAMES, "2025-10-24")!;

    expect(s.pie).not.toBeCloseTo((0.2 * 40) / (40 + 4.8), 4);
  });

  // The exclusion is scoped to PIE alone. Those minutes were really played and
  // the box score really happened; dropping the game wholesale would understate
  // his workload and his rebounds.
  it("keeps the game in every other statistic", () => {
    const s = seasonToDate([STARTER, ARTIFACT], TEAM_GAMES, "2025-10-24")!;

    expect(s.gamesPlayed).toBe(2);
    expect(s.totalMinutes).toBeCloseTo(44.8, 10);
    expect(s.reboundsPerGame).toBeCloseTo((10 + 4) / 2, 10);
    expect(s.usageRate).toBeCloseTo((0.3 * 40 + 0.091 * 4.8) / 44.8, 10);
  });

  // The threshold has to admit genuinely bad games. A PIE of -0.5 is a real
  // performance, not an artifact, and must still count.
  it("keeps legitimately poor games", () => {
    const poor = game({ gameId: "POOR", date: "2025-10-24", minutes: 20, pie: -0.5 });
    const s = seasonToDate([STARTER, poor], TEAM_GAMES, "2025-10-24")!;

    expect(s.pie).toBeCloseTo((0.2 * 40 + -0.5 * 20) / 60, 12);
  });

  // If every game a player has is an artifact, there is no average to report.
  // Zero is the honest answer, and it must not be NaN.
  it("reports zero rather than NaN when every game is excluded", () => {
    const s = seasonToDate([ARTIFACT], TEAM_GAMES, "2025-10-24")!;

    expect(Number.isFinite(s.pie)).toBe(true);
    expect(s.pie).toBe(0);
  });
});

describe("seasonToDate guards", () => {
  // Zero-minute rows are dropped at ingestion, but a zero possession total can
  // still occur. Infinity and NaN both survive Zod as numbers, reach MongoDB,
  // and then sort unpredictably instead of failing.
  it("does not divide by a zero possession total", () => {
    const noPossessions = game({ minutes: 10, possessions: 0, netRating: 50 });
    const s = seasonToDate([noPossessions], TEAM_GAMES, "2025-10-21")!;

    expect(Number.isFinite(s.netRating)).toBe(true);
    expect(s.netRating).toBe(0);
  });

  it("does not divide by a zero shooting-possession total", () => {
    const noShots = game({ fieldGoalAttempts: 0, freeThrowAttempts: 0, points: 0 });
    const s = seasonToDate([noShots], TEAM_GAMES, "2025-10-21")!;

    expect(Number.isFinite(s.trueShootingPercentage)).toBe(true);
    expect(s.trueShootingPercentage).toBe(0);
  });
});

describe("teamContextAsOf", () => {
  const TRADE_TEAMS = indexTeamGames([
    // Old team plays four games; the player is there for the first two.
    teamGame({ teamId: 100, gameId: "A1", date: "2025-10-21", won: true }),
    teamGame({ teamId: 100, gameId: "A2", date: "2025-10-23", won: true }),
    teamGame({ teamId: 100, gameId: "A3", date: "2025-10-25", won: false }),
    teamGame({ teamId: 100, gameId: "A4", date: "2025-10-27", won: false }),
    // New team plays four; he arrives for the last two.
    teamGame({ teamId: 200, teamAbbr: "BBB", gameId: "B1", date: "2025-10-22", won: false }),
    teamGame({ teamId: 200, teamAbbr: "BBB", gameId: "B2", date: "2025-10-24", won: false }),
    teamGame({ teamId: 200, teamAbbr: "BBB", gameId: "B3", date: "2025-10-26", won: true }),
    teamGame({ teamId: 200, teamAbbr: "BBB", gameId: "B4", date: "2025-10-28", won: true }),
  ]);

  const TRADED = [
    game({ teamId: 100, gameId: "A1", date: "2025-10-21", won: true }),
    game({ teamId: 100, gameId: "A2", date: "2025-10-23", won: true }),
    game({ teamId: 200, teamAbbr: "BBB", gameId: "B3", date: "2025-10-26", won: true }),
    game({ teamId: 200, teamAbbr: "BBB", gameId: "B4", date: "2025-10-28", won: true }),
  ];

  // The whole point of stint-awareness. Counting the new team's full season
  // would charge the player for games played before he arrived; counting only
  // the new team's record would discard his old one entirely.
  //
  // The stint boundary is his arrival at the new club (2025-10-26), so the old
  // club contributes A1, A2 and A3 — including A3, which he missed while still
  // on its roster — and the new club contributes B3 and B4. Five games, of
  // which he played four.
  it("splits the season at the date he joins the new team", () => {
    const ctx = teamContextAsOf(TRADED, TRADE_TEAMS, "2025-10-28");

    expect(ctx.teamGamesPlayed).toBe(5);
    expect(ctx.teamWins).toBe(4); // A3 was a loss
  });

  // The regression this rule exists for. Bounding the window by a player's own
  // first and last appearance makes missed games unobservable: Jayson Tatum
  // played 16 games in 2025-26 and scored an "availability" of 0.89, fifth in
  // the league. Here the same shape — a late debut after a long absence — must
  // be charged for the whole season.
  it("charges a late-returning player for the games before his debut", () => {
    const lateReturn = [
      game({ teamId: 100, gameId: "A4", date: "2025-10-27" }),
    ];
    const ctx = teamContextAsOf(lateReturn, TRADE_TEAMS, "2025-10-27");

    expect(ctx.teamGamesPlayed).toBe(4); // A1..A4, not just A4
    expect(lateReturn.length / ctx.teamGamesPlayed).toBeCloseTo(0.25, 12);
  });

  // The mirror case: a player who stops playing must be charged for the rest of
  // the season, not have the window close behind him.
  it("charges a player for games after his last appearance", () => {
    const stoppedEarly = [
      game({ teamId: 100, gameId: "A1", date: "2025-10-21" }),
      game({ teamId: 100, gameId: "A2", date: "2025-10-23" }),
    ];
    const ctx = teamContextAsOf(stoppedEarly, TRADE_TEAMS, "2025-10-27");

    expect(ctx.teamGamesPlayed).toBe(4); // A1..A4
  });

  // The invariant that makes availability meaningful. If team games were counted
  // across both franchises' full schedules, a traded player's availability could
  // exceed 1 and hand him a bonus for being traded.
  it("keeps games played at or below team games played", () => {
    for (const upto of ["2025-10-21", "2025-10-23", "2025-10-26", "2025-10-28"]) {
      const played = TRADED.filter((g) => g.date <= upto).length;
      const ctx = teamContextAsOf(TRADED, TRADE_TEAMS, upto);

      expect(ctx.teamGamesPlayed).toBeGreaterThanOrEqual(played);
    }
  });

  // A player who misses games inside his stint must still be charged for them —
  // that is exactly what availability is measuring.
  it("counts team games the player missed within his stint", () => {
    const missedMiddle = [
      game({ teamId: 100, gameId: "A1", date: "2025-10-21" }),
      game({ teamId: 100, gameId: "A4", date: "2025-10-27" }),
    ];
    const ctx = teamContextAsOf(missedMiddle, TRADE_TEAMS, "2025-10-27");

    expect(ctx.teamGamesPlayed).toBe(4); // A1..A4
    expect(missedMiddle.length).toBe(2); // availability 0.5
  });

  // Team context must respect the cutoff as well as the stint.
  it("ignores team games after the cutoff", () => {
    const ctx = teamContextAsOf(TRADED, TRADE_TEAMS, "2025-10-23");

    expect(ctx.teamGamesPlayed).toBe(2);
    expect(ctx.teamWins).toBe(2);
  });
});

describe("indexing helpers", () => {
  it("groups games by player, ascending by date", () => {
    const byPlayer = indexPlayerGames([
      game({ playerId: 2, date: "2025-10-25" }),
      game({ playerId: 1, date: "2025-10-23" }),
      game({ playerId: 1, date: "2025-10-21" }),
    ]);

    expect([...byPlayer.keys()].sort()).toEqual([1, 2]);
    expect(byPlayer.get(1)!.map((g) => g.date)).toEqual(["2025-10-21", "2025-10-23"]);
  });

  // Dates are ISO, so lexicographic sorting is chronological — but only because
  // they are zero-padded and the time suffix was stripped at ingestion.
  it("returns unique game dates in chronological order", () => {
    const dates = gameDates([
      game({ date: "2026-01-05" }),
      game({ date: "2025-12-31" }),
      game({ date: "2026-01-05" }),
      game({ date: "2025-11-09" }),
    ]);

    expect(dates).toEqual(["2025-11-09", "2025-12-31", "2026-01-05"]);
  });
});
