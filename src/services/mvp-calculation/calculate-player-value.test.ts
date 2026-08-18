// Tests for the MVP scoring rule (formula version 3).
//
// This is the one piece of the project that is genuinely its own idea — ingestion
// and storage are plumbing around it. It is also a long arithmetic expression
// with no natural error signal: get a coefficient or a scale wrong and every
// number that comes out is still a plausible-looking number, ranked in a
// plausible-looking order.
//
// So the expected values below are written out longhand from the documented
// formula rather than copied from a previous run. A test that asserts "the code
// returns what the code returned yesterday" would pass straight through a typo'd
// coefficient; these fail on it.

import { describe, expect, it } from "vitest";
import {
  calculateAllPlayerValues,
  calculatePlayerValue,
} from "./calculate-player-value";
import {
  BreakdownSchema,
  CURRENT_FORMULA_VERSION,
  FullPlayerSummary,
  FullPlayerSummarySchema,
} from "../../utils/types";
import { scoreBreakdown } from "../../shared/mvp-formula";

/**
 * A complete, schema-valid player. Tests override only what they exercise.
 *
 * Note the scales, because they are the easiest thing to get wrong: `usageRate`,
 * `pie` and `trueShootingPercentage` are all FRACTIONS, exactly as the NBA stats
 * API returns them. `netRating` is already points per 100 possessions.
 */
function player(overrides: Partial<FullPlayerSummary> = {}): FullPlayerSummary {
  return {
    player: "Test Player",
    profileUrl: "https://www.nba.com/player/203999",
    team: "DEN",
    pos: "C",
    age: 30,
    teamWins: 38,
    teamLosses: 17,
    teamGamesPlayed: 55,
    gamesStarted: 54,
    // Available for every game unless a test says otherwise, so availability is
    // 1 and does not perturb the other assertions.
    gamesPlayed: 55,
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
    ...overrides,
  };
}

describe("calculatePlayerValue", () => {
  // The whole formula in one assertion, spelled out from the spec in the header
  // of the module under test. Guards against any silent change to a coefficient,
  // a weight, the /25 and /48 divisors, or the ×100 on PIE.
  it("matches the documented formula", () => {
    const levelOfImpact = (38 / 55) * (36 / 48) * 0.3;
    const qualityOfImpact = 0.4 * (0.22 * 100) + 0.2 * 12;
    const winContribution = levelOfImpact * qualityOfImpact;
    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;

    expect(calculatePlayerValue(player())).toBeCloseTo(
      0.5 * winContribution + 0.5 * totalStats,
      10,
    );
  });

  // The single most dangerous property in this formula.
  //
  // Usage arrives from the API as 0.288, and the formula uses it AS the factor.
  // The previous version divided by 100 because Basketball Reference returned
  // 28.8. Dividing a fraction again shrinks the win half a hundredfold and still
  // produces a perfectly ordered leaderboard.
  it("uses the usage fraction directly, without dividing by 100", () => {
    const statsHalf = calculatePlayerValue(player({ usageRate: 0 }));
    const doubled = calculatePlayerValue(player({ usageRate: 0.6 }));
    const base = calculatePlayerValue(player({ usageRate: 0.3 }));

    // Doubling usage doubles the win half exactly.
    expect(doubled - statsHalf).toBeCloseTo(2 * (base - statsHalf), 10);

    // And the factor is the raw fraction: 0.3 usage must contribute the win half
    // computed with 0.3, not 0.003.
    const expectedWinHalf =
      0.5 * ((38 / 55) * (36 / 48) * 0.3) * (0.4 * 22 + 0.2 * 12);
    expect(base - statsHalf).toBeCloseTo(expectedWinHalf, 10);
  });

  // The mirror-image trap. PIE is also a fraction but must be scaled by 100 to
  // reach net rating's magnitude. Unscaled it contributes under 4% of quality of
  // impact instead of ~80%, and the score collapses into net rating.
  it("scales PIE by 100 so it is not swamped by net rating", () => {
    const q = 0.4 * (0.22 * 100) + 0.2 * 12; // 8.8 + 2.4
    const pieShare = (0.4 * (0.22 * 100)) / q;

    expect(q).toBeCloseTo(11.2, 10);
    expect(pieShare).toBeGreaterThan(0.7); // PIE carries the term, as intended

    const unscaled = 0.4 * 0.22 + 0.2 * 12;
    expect((0.4 * 0.22) / unscaled).toBeLessThan(0.05); // what going wrong looks like
  });

  // True shooting is NOT scaled — it multiplies points as a decimal. A blanket
  // "multiply every fraction by 100" would inflate Total Stats sixty-fold while
  // leaving the ordering broadly intact.
  it("uses true shooting as a decimal, unscaled", () => {
    const statsOnly = calculatePlayerValue(player({ usageRate: 0 }));
    const better = calculatePlayerValue(
      player({ usageRate: 0, trueShootingPercentage: 0.76 }),
    );
    // +0.1 TS% on 30 points adds 0.5 × 30 × 0.1 / 25 to the score.
    expect(better - statsOnly).toBeCloseTo((0.5 * 30 * 0.1) / 25, 10);
  });

  // The two halves are weighted equally by design. Guards against someone
  // rebalancing without updating the README, which shows this split to users.
  it("weights win contribution and total stats equally", () => {
    const statsOnly = calculatePlayerValue(player({ usageRate: 0 }));
    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;

    expect(statsOnly).toBeCloseTo(0.5 * totalStats, 10);
  });

  // Points and assists are ADDED inside Total Stats. A zero-assist player
  // separates that from a multiplied reading cleanly: under the code the points
  // term survives, under a multiplication the whole product collapses to zero.
  it("adds the points term to the assists term rather than multiplying", () => {
    const noAssists = calculatePlayerValue(
      player({ assistsPerGame: 0, usageRate: 0 }),
    );
    const pointsTermSurvives = (30 * 0.66 + 1.2 * 12 + 3 + 6 - 2 - 3) / 25;

    expect(noAssists).toBeCloseTo(0.5 * pointsTermSurvives, 10);
    expect(noAssists).toBeGreaterThan(0);
  });

  // Net rating is routinely negative for players on bad teams. Guards against a
  // future "clamp everything at zero" that would flatten the bottom of the board.
  it("allows a negative score", () => {
    const bad = player({
      pointsPerGame: 2,
      assistsPerGame: 0,
      reboundsPerGame: 1,
      blocksPerGame: 0,
      stealsPerGame: 0,
      foulsPerGame: 5,
      turnoversPerGame: 6,
      pie: 0.02,
      netRating: -12,
    });

    expect(calculatePlayerValue(bad)).toBeLessThan(0);
  });

  // Early in a season, and for any row where team context is missing, games
  // played can be zero. Without the guards this divides by zero twice, and NaN
  // comparisons are all false — so the ranking sort silently stops sorting
  // rather than visibly breaking.
  it("returns zero when the team has played no games", () => {
    const value = calculatePlayerValue(
      player({ teamGamesPlayed: 0, teamWins: 0, gamesPlayed: 0 }),
    );

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(0);
  });
});

describe("calculateAllPlayerValues", () => {
  // The contract the front end depends on: index 0 is the MVP. Guards against an
  // ascending sort, which would render a convincing leaderboard of the worst
  // players in the league.
  it("orders players by descending value", () => {
    const ranked = calculateAllPlayerValues([
      player({ player: "Middle", pie: 0.15 }),
      player({ player: "Best", pie: 0.25 }),
      player({ player: "Worst", pie: 0.05 }),
    ]);

    expect(ranked.map((r) => r.player)).toEqual(["Best", "Middle", "Worst"]);
    expect(ranked[0].mvpValue).toBeGreaterThan(ranked[1].mvpValue);
    expect(ranked[1].mvpValue).toBeGreaterThan(ranked[2].mvpValue);
  });

  // Ranks are 1-indexed and contiguous where they are assigned at all. Note the
  // storage layer no longer persists these — rank is derived when a date is
  // asked for — but the ordering contract still holds here.
  it("assigns contiguous ranks starting at 1", () => {
    const ranked = calculateAllPlayerValues([
      player({ player: "a", pie: 0.10 }),
      player({ player: "b", pie: 0.20 }),
      player({ player: "c", pie: 0.30 }),
    ]);

    expect(ranked.map((r) => r.calculatedRank)).toEqual([1, 2, 3]);
  });

  // Documents the tie-break, which is "none" — equal scores keep input order,
  // because Array.prototype.sort is stable.
  it("keeps input order for exactly-tied scores", () => {
    const ranked = calculateAllPlayerValues([
      player({ player: "first" }),
      player({ player: "second" }),
    ]);

    expect(ranked[0].mvpValue).toBe(ranked[1].mvpValue);
    expect(ranked.map((r) => r.player)).toEqual(["first", "second"]);
  });

  // Everything scraped has to survive into the stored row, because the profile
  // view reads the stat line straight off the ranking payload.
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
  // Guards the fail-loud behaviour: a bad row must stop the pipeline rather than
  // reach MongoDB, because once stored the API serves it and the UI renders NaN.
  it("throws rather than emitting a row that fails validation", () => {
    const broken = player();
    // @ts-expect-error deliberately violating the schema the ingest guarantees
    broken.pie = null;

    expect(() => calculateAllPlayerValues([broken])).toThrow();
  });
});

describe("the stored row keeps the whole breakdown", () => {
  // Zod strips unknown keys. If BreakdownSchema is missing a field that
  // scoreBreakdown() returns, that field is silently dropped on its way to
  // MongoDB — no error, no warning, just a column that is never written and a
  // front end that has to recompute it. That is precisely the gap that once gave
  // this app two implementations of one formula.
  it("stores every term the formula computes", () => {
    const computed = Object.keys(scoreBreakdown(player()));
    const stored = Object.keys(BreakdownSchema.shape);

    expect(stored.sort()).toEqual(computed.sort());
  });

  it("survives validation with every term intact", () => {
    const p = player({ gamesPlayed: 40, teamGamesPlayed: 55 });
    const expected = scoreBreakdown(p);
    const [row] = calculateAllPlayerValues([p]);

    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      expect(row[key]).toBeCloseTo(expected[key], 12);
    }
  });

  // The front end reads these to draw the win/stats split bar and the formula
  // panel. If they did not reconcile with mvpValue, the UI would show numbers
  // that do not add up to the total printed beside them — which it once did.
  it("stores terms that reconcile with the stored score", () => {
    const [row] = calculateAllPlayerValues([
      player({ gamesPlayed: 40, teamGamesPlayed: 55 }),
    ]);

    expect(0.5 * row.winContribution + 0.5 * row.totalStats).toBeCloseTo(
      row.rawValue,
      12,
    );
    expect(row.availability * row.rawValue).toBeCloseTo(row.mvpValue, 12);
  });
});

describe("availability", () => {
  const ironMan = player({ gamesPlayed: 55, teamGamesPlayed: 55 });
  const injured = player({ gamesPlayed: 25, teamGamesPlayed: 55 });

  it("carries the player's own games played", () => {
    expect(Object.keys(FullPlayerSummarySchema.shape)).toContain("gamesPlayed");
  });

  // Under formula 3 the penalty is EXACTLY proportional, and that is a change
  // worth pinning.
  //
  // Version 2 was harsher than pro-rating — 0.384 for a player at 45%
  // availability — because VORP and Win Shares were cumulative and stopped
  // accruing while he sat, so absence was charged twice. PIE and net rating are
  // both rates and do not accumulate, so the multiplier is now the only term
  // that notices absence at all.
  it("penalises absence exactly in proportion to games missed", () => {
    const full = calculatePlayerValue(ironMan);
    const partial = calculatePlayerValue(injured);

    expect(partial / full).toBeCloseTo(25 / 55, 10);
  });

  // Pins the shape of the curve rather than one point on it.
  it("scales monotonically with games played", () => {
    const scores = [55, 45, 35, 25, 15].map((g) =>
      calculatePlayerValue(player({ gamesPlayed: g, teamGamesPlayed: 55 })),
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  // A player who never sat must be unaffected, since availability is exactly 1.
  // Guards against the factor being applied as a penalty to everyone, which
  // would deflate the whole board uniformly and therefore change no ranks —
  // making it invisible.
  it("leaves an ever-present player's score unchanged", () => {
    const levelOfImpact = (38 / 55) * (36 / 48) * 0.3;
    const qualityOfImpact = 0.4 * (0.22 * 100) + 0.2 * 12;
    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;

    expect(calculatePlayerValue(ironMan)).toBeCloseTo(
      0.5 * levelOfImpact * qualityOfImpact + 0.5 * totalStats,
      10,
    );
  });

  // Availability scales BOTH halves, which is why it multiplies the total rather
  // than sitting inside Level of Impact. Total Stats is the larger half; leaving
  // it immune is what made version 1's blind spot so large.
  it("scales the Total Stats half too", () => {
    const fullStatsHalf = calculatePlayerValue({ ...ironMan, usageRate: 0 });
    const partialStatsHalf = calculatePlayerValue({ ...injured, usageRate: 0 });

    expect(partialStatsHalf).toBeCloseTo(fullStatsHalf * (25 / 55), 10);
  });
});

describe("formula version", () => {
  // Every stored row records which formula produced it. The app draws rank
  // deltas between consecutive days, which only means something if both days
  // were measured with the same ruler.
  it("stamps rows with the current formula version", () => {
    const [row] = calculateAllPlayerValues([player()]);
    expect(row.formulaVersion).toBe(CURRENT_FORMULA_VERSION);
  });

  // Version 3 IS the PIE/Net Rating revision. If this file ever needs a version
  // 4, this assertion should be updated deliberately rather than incidentally.
  it("is on version 3, the PIE and net rating revision", () => {
    expect(CURRENT_FORMULA_VERSION).toBe(3);
  });
});
