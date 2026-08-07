// Tests for the MVP scoring rule.
//
// This is the one piece of the project that is genuinely its own idea — the
// scraper and the API are plumbing around it. It is also a long arithmetic
// expression with no natural error signal: get a coefficient wrong and every
// number that comes out is still a plausible-looking number, ranked in a
// plausible-looking order.
//
// So the expected values below are written out longhand from the documented
// formula rather than copied from a previous run. A test that asserts "the
// code returns what the code returned yesterday" would pass through a typo'd
// coefficient; these fail on it.

import { describe, expect, it } from "vitest";
import {
  calculateAllPlayerValues,
  calculatePlayerValue,
} from "./calculate-player-value";
import { FullPlayerSummary } from "../../utils/types";

/** A complete, schema-valid player. Tests override only what they exercise. */
function player(overrides: Partial<FullPlayerSummary> = {}): FullPlayerSummary {
  return {
    player: "Test Player",
    profileUrl: "https://www.basketball-reference.com/players/t/test01.html",
    team: "DEN",
    teamWins: 38,
    teamGamesPlayed: 55,
    gamesStarted: 54,
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
    ...overrides,
  };
}

describe("calculatePlayerValue", () => {
  // The whole formula in one assertion, spelled out from the spec in the
  // header comment of the module under test. Guards against any silent change
  // to a coefficient, a weight, or the /25 and /48 divisors.
  it("matches the documented formula", () => {
    const p = player();

    const levelOfImpact = (38 / 55) * (36 / 48) * (30 / 100);
    const qualityOfImpact = 0.4 * (6 + 10) + 0.2 * 12;
    const winContribution = levelOfImpact * qualityOfImpact;
    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;

    expect(calculatePlayerValue(p)).toBeCloseTo(
      0.5 * winContribution + 0.5 * totalStats,
      10,
    );
  });

  // The two halves are weighted equally by design. Guards against someone
  // rebalancing the formula without updating the README, which shows this
  // split to the user in the "How it works" panel.
  it("weights win contribution and total stats equally", () => {
    // Zero out the win-contribution half via usage rate; what remains is
    // exactly half the total-stats term.
    const statsOnly = calculatePlayerValue(player({ usageRate: 0 }));
    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;

    expect(statsOnly).toBeCloseTo(0.5 * totalStats, 10);
  });

  // Points and assists are ADDED inside Total Stats. The comment at the top of
  // calculate-player-value.ts currently writes that term as
  //   Points * True Shooting % * 1.5(Assists) + ...
  // with a multiplication where the code has a plus. A zero-assist player
  // separates the two readings cleanly: under the code the points term
  // survives, under the comment the whole product collapses to zero.
  //
  // This test asserts the CODE's behaviour, which is the one the stored
  // rankings were computed with. The comment is what needs fixing.
  it("adds the points term to the assists term rather than multiplying", () => {
    const noAssists = calculatePlayerValue(
      player({ assistsPerGame: 0, usageRate: 0 }),
    );

    const pointsTermSurvives = (30 * 0.66 + 1.2 * 12 + 3 + 6 - 2 - 3) / 25;
    expect(noAssists).toBeCloseTo(0.5 * pointsTermSurvives, 10);
    expect(noAssists).toBeGreaterThan(0);
  });

  // Early in a season, and for any team row the scraper failed to read, games
  // played can be zero. Without the guard this is a division by zero, and the
  // NaN propagates through the sort — NaN comparisons are all false, so the
  // ranking silently stops sorting rather than visibly breaking.
  it("returns a finite score when the team has played no games", () => {
    const value = calculatePlayerValue(player({ teamGamesPlayed: 0, teamWins: 0 }));

    expect(Number.isFinite(value)).toBe(true);

    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;
    expect(value).toBeCloseTo(0.5 * totalStats, 10);
  });

  // Box plus/minus is routinely negative for fringe candidates, and fouls and
  // turnovers subtract. Guards against a future "clamp everything at zero"
  // that would flatten the bottom of the board into a tie.
  it("allows a negative score", () => {
    const bad = player({
      pointsPerGame: 2,
      assistsPerGame: 0,
      reboundsPerGame: 1,
      blocksPerGame: 0,
      stealsPerGame: 0,
      foulsPerGame: 5,
      turnoversPerGame: 6,
      boxPlusMinus: -8,
      valueOverReplacement: -1,
      winShare: 0,
    });

    expect(calculatePlayerValue(bad)).toBeLessThan(0);
  });

  // Usage rate arrives from Basketball Reference as a percentage (30.1, not
  // 0.301) and true shooting as a decimal (0.662, not 66.2). Mixing the two
  // conventions is a 100x error that still produces a ranked list. Guards the
  // /100 on usage and the absence of one on true shooting.
  it("treats usage rate as a percentage and true shooting as a decimal", () => {
    const doubledUsage = calculatePlayerValue(player({ usageRate: 60 }));
    const baseline = calculatePlayerValue(player());
    const statsHalf = calculatePlayerValue(player({ usageRate: 0 }));

    // Doubling usage doubles only the win-contribution half.
    expect(doubledUsage - statsHalf).toBeCloseTo(2 * (baseline - statsHalf), 10);

    // True shooting is used as-is: raising it by 0.1 adds 0.5 * PTS * 0.1 / 25.
    const better = calculatePlayerValue(
      player({ trueShootingPercentage: 0.76, usageRate: 0 }),
    );
    expect(better - statsHalf).toBeCloseTo((0.5 * 30 * 0.1) / 25, 10);
  });
});

describe("calculateAllPlayerValues", () => {
  // The contract the front end depends on: index 0 is the MVP. Guards against
  // an ascending sort, which would render a perfectly convincing leaderboard
  // of the worst players in the league.
  it("orders players by descending value", () => {
    const ranked = calculateAllPlayerValues([
      player({ player: "Middle", pointsPerGame: 25 }),
      player({ player: "Best", pointsPerGame: 35 }),
      player({ player: "Worst", pointsPerGame: 15 }),
    ]);

    expect(ranked.map((r) => r.player)).toEqual(["Best", "Middle", "Worst"]);
    expect(ranked[0].mvpValue).toBeGreaterThan(ranked[1].mvpValue);
    expect(ranked[1].mvpValue).toBeGreaterThan(ranked[2].mvpValue);
  });

  // Ranks are 1-indexed and contiguous. The UI prints calculatedRank directly
  // and the front end computes day-over-day movement by subtracting them, so
  // an off-by-one here shows every player as having moved.
  it("assigns contiguous ranks starting at 1", () => {
    const ranked = calculateAllPlayerValues([
      player({ player: "a", pointsPerGame: 10 }),
      player({ player: "b", pointsPerGame: 20 }),
      player({ player: "c", pointsPerGame: 30 }),
    ]);

    expect(ranked.map((r) => r.calculatedRank)).toEqual([1, 2, 3]);
  });

  // Documents the tie-break, which is "none" — equal scores keep their input
  // order, because Array.prototype.sort is stable. Worth pinning: the input
  // order is the scraper's order, so if that ever becomes nondeterministic,
  // tied players will swap places between days and register as rank movement
  // that never happened.
  it("keeps input order for exactly-tied scores", () => {
    const ranked = calculateAllPlayerValues([
      player({ player: "first" }),
      player({ player: "second" }),
    ]);

    expect(ranked[0].mvpValue).toBe(ranked[1].mvpValue);
    expect(ranked.map((r) => r.player)).toEqual(["first", "second"]);
  });

  // Everything scraped has to survive into the stored row, because the profile
  // view reads per-game and advanced stats straight off the ranking payload.
  // Guards against a refactor that returns only the score and the rank.
  it("carries every input field through to the output", () => {
    const input = player({ player: "Carried", team: "OKC" });
    const [row] = calculateAllPlayerValues([input]);

    for (const key of Object.keys(input) as (keyof FullPlayerSummary)[]) {
      expect(row[key]).toEqual(input[key]);
    }
  });

  it("returns an empty array for no players", () => {
    expect(calculateAllPlayerValues([])).toEqual([]);
  });

  // The output is re-validated against the Zod schema before being returned.
  // Guards the fail-loud behaviour: a bad row must stop the pipeline rather
  // than reach MongoDB, because once it is stored the API will serve it and
  // the front end will render NaN.
  it("throws rather than emitting a row that fails validation", () => {
    const broken = player();
    // @ts-expect-error deliberately violating the schema the scraper guarantees
    broken.usageRate = null;

    expect(() => calculateAllPlayerValues([broken])).toThrow();
  });
});
