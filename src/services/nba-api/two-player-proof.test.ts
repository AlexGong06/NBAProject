// The two-player proof, against real 2025-26 data.
//
// The unit tests next door prove the aggregation rules on synthetic games with
// numbers chosen to make errors obvious. This file proves the whole chain —
// join, aggregate, score — reproduces known values for two real players across
// a full season, including the case the design exists to handle.
//
//   Nikola Jokić   never changed teams. The simple path.
//   James Harden   traded LAC → CLE mid-season. Team context has to follow him,
//                  and `availability ≤ 1` has to survive it.
//
// It runs offline against test/fixtures/two-player-season-2025-26.json, captured
// from the live API by scripts/generate-two-player-fixture.ts. A proof that only
// holds while stats.nba.com is reachable is a status check, not a regression
// test — and this one has to keep working on a plane.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  gameDates,
  indexPlayerGames,
  indexTeamGames,
  seasonToDate,
} from "./season-to-date";
import type { PlayerGame, TeamGame } from "./fetch-season";
import { scoreBreakdown } from "../../shared/mvp-formula";

type Fixture = { season: string; playerGames: PlayerGame[]; teamGames: TeamGame[] };

const fixture: Fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../../../test/fixtures/two-player-season-2025-26.json"),
    "utf8",
  ),
);

const JOKIC = 203999;
const HARDEN = 201935;

const byPlayer = indexPlayerGames(fixture.playerGames);
const byTeam = indexTeamGames(fixture.teamGames);
const allDates = gameDates(fixture.playerGames);

function asOf(playerId: number, date: string) {
  const games = byPlayer.get(playerId);
  if (!games) throw new Error(`No games for player ${playerId}`);
  const stats = seasonToDate(games, byTeam, date);
  if (!stats) throw new Error(`No stats for ${playerId} as of ${date}`);
  return { stats, breakdown: scoreBreakdown(stats) };
}

describe("the fixture itself", () => {
  // If the fixture is ever regenerated against a different season, every
  // expected value below is silently wrong. Pin what it is.
  it("holds both players' full 2025-26 seasons", () => {
    expect(fixture.season).toBe("2025-26");
    expect(byPlayer.get(JOKIC)).toHaveLength(65);
    expect(byPlayer.get(HARDEN)).toHaveLength(70);
    expect(fixture.teamGames).toHaveLength(246); // three franchises, 82 each
  });

  // The date suffix trap: the API sends "2026-04-12T00:00:00", and a bare
  // string compare against "2026-04-12" drops the final day of any range.
  it("stores dates as bare ISO days, with no time component", () => {
    for (const g of fixture.playerGames) {
      expect(g.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("Nikola Jokić — never traded", () => {
  // Three checkpoints across the season. These are the numbers the pipeline
  // produced when it was verified by hand; any change to the join, the
  // weighting or the formula constants moves them.
  it.each([
    // date          GP  teamGP  wins   PIE×100   netRating  mvpValue
    ["2025-11-30", 19, 19, 14, 23.8761, 14.1497, 1.958758],
    ["2026-02-15", 39, 55, 35, 22.6866, 11.6553, 1.260783],
    ["2026-04-12", 65, 82, 54, 21.4197, 10.7717, 1.385065],
  ])(
    "as of %s",
    (date, gp, teamGp, wins, pie, netRating, mvpValue) => {
      const { stats, breakdown } = asOf(JOKIC, date as string);

      expect(stats.gamesPlayed).toBe(gp);
      expect(stats.teamGamesPlayed).toBe(teamGp);
      expect(stats.teamWins).toBe(wins);
      expect(stats.pie * 100).toBeCloseTo(pie as number, 3);
      expect(stats.netRating).toBeCloseTo(netRating as number, 3);
      expect(breakdown.mvpValue).toBeCloseTo(mvpValue as number, 5);
    },
  );

  // He played his team's first and last game, so on the final day availability
  // is his games over the full 82 — not 1.0. A pipeline that quietly counted
  // only the games he appeared in would report a perfect 1.0 here.
  it("is charged for the 17 games he missed", () => {
    const { breakdown } = asOf(JOKIC, "2026-04-12");

    expect(breakdown.availability).toBeCloseTo(65 / 82, 12);
    expect(breakdown.availability).toBeLessThan(0.8);
  });

  // Season-to-date rates must stay in range even though single-game values do
  // not. A season PIE above ~0.35 means the weighting is wrong, not that
  // somebody had a great year.
  it("keeps season rates in a plausible range all year", () => {
    for (const date of allDates) {
      const games = byPlayer.get(JOKIC)!;
      const stats = seasonToDate(games, byTeam, date);
      if (!stats) continue;

      expect(stats.pie).toBeGreaterThan(0);
      expect(stats.pie).toBeLessThan(0.35);
      expect(stats.usageRate).toBeGreaterThan(0);
      expect(stats.usageRate).toBeLessThan(0.45);
      expect(stats.trueShootingPercentage).toBeGreaterThan(0.4);
      expect(stats.trueShootingPercentage).toBeLessThan(0.9);
      expect(Math.abs(stats.netRating)).toBeLessThan(40);
    }
  });
});

describe("James Harden — traded mid-season", () => {
  it.each([
    // date          GP  teamGP  wins   PIE×100  netRating  mvpValue
    ["2026-01-15", 37, 40, 17, 14.9172, 0.2209, 0.865313],
    ["2026-04-12", 70, 81, 45, 14.3330, 1.8036, 0.836314],
  ])(
    "as of %s",
    (date, gp, teamGp, wins, pie, netRating, mvpValue) => {
      const { stats, breakdown } = asOf(HARDEN, date as string);

      expect(stats.gamesPlayed).toBe(gp);
      expect(stats.teamGamesPlayed).toBe(teamGp);
      expect(stats.teamWins).toBe(wins);
      expect(stats.pie * 100).toBeCloseTo(pie as number, 3);
      expect(stats.netRating).toBeCloseTo(netRating as number, 3);
      expect(breakdown.mvpValue).toBeCloseTo(mvpValue as number, 5);
    },
  );

  // The trade is real and it splits cleanly. If this ever collapses to one team,
  // the fixture changed and the stint logic below is no longer being exercised.
  it("actually spans two teams", () => {
    const teams = new Set(byPlayer.get(HARDEN)!.map((g) => g.teamAbbr));
    expect(teams.size).toBe(2);
  });

  // The invariant the stint logic exists to protect. Counting his new team's
  // whole season would include games played before he arrived, and his
  // availability could exceed 1 — rewarding him for having been traded.
  it("never exceeds an availability of 1, on any date", () => {
    const games = byPlayer.get(HARDEN)!;

    for (const date of allDates) {
      const stats = seasonToDate(games, byTeam, date);
      if (!stats) continue;

      expect(stats.gamesPlayed).toBeLessThanOrEqual(stats.teamGamesPlayed);
      expect(stats.teamWins).toBeLessThanOrEqual(stats.teamGamesPlayed);
      expect(scoreBreakdown(stats).availability).toBeLessThanOrEqual(1);
    }
  });

  // His team context has to keep accruing across the trade rather than resetting
  // to the new club's record.
  it("carries team context through the trade rather than restarting it", () => {
    const before = asOf(HARDEN, "2026-01-15").stats;
    const after = asOf(HARDEN, "2026-04-12").stats;

    expect(after.teamGamesPlayed).toBeGreaterThan(before.teamGamesPlayed);
    expect(after.teamWins).toBeGreaterThanOrEqual(before.teamWins);
    expect(after.gamesPlayed).toBeGreaterThan(before.gamesPlayed);
  });
});

describe("invariants across every player-date in the fixture", () => {
  // The same assertions Phase 3 will run over all 582 players. Cheap here, and
  // they catch a broken aggregation before it is written 95,000 times.
  it("produces finite, well-formed scores on every date", () => {
    for (const playerId of [JOKIC, HARDEN]) {
      const games = byPlayer.get(playerId)!;

      for (const date of allDates) {
        const stats = seasonToDate(games, byTeam, date);
        if (!stats) continue;
        const b = scoreBreakdown(stats);

        for (const [key, value] of Object.entries(b)) {
          expect(Number.isFinite(value), `${playerId} ${date} ${key}`).toBe(true);
        }

        expect(b.availability).toBeGreaterThan(0);
        expect(b.availability).toBeLessThanOrEqual(1);
        // The two identities the stored breakdown must satisfy.
        expect(0.5 * b.winContribution + 0.5 * b.totalStats).toBeCloseTo(b.rawValue, 10);
        expect(b.availability * b.rawValue).toBeCloseTo(b.mvpValue, 10);
      }
    }
  });
});
