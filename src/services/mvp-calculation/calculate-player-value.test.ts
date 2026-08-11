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
import {
  BreakdownSchema,
  CURRENT_FORMULA_VERSION,
  FullPlayerSummary,
  FullPlayerSummarySchema,
} from "../../utils/types";
import { scoreBreakdown } from "../../shared/mvp-formula";

/** A complete, schema-valid player. Tests override only what they exercise. */
function player(overrides: Partial<FullPlayerSummary> = {}): FullPlayerSummary {
  return {
    player: "Test Player",
    profileUrl: "https://www.basketball-reference.com/players/t/test01.html",
    team: "DEN",
    pos: "C",
    age: 30,
    teamWins: 38,
    teamLosses: 17,
    teamGamesPlayed: 55,
    gamesStarted: 54,
    // Available for every game unless a test says otherwise, so the
    // availability factor is 1 and does not perturb the other assertions.
    gamesPlayed: 55,
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

  // Points and assists are ADDED inside Total Stats. The header comment on the
  // module once wrote that term with a multiplication there, and a zero-assist
  // player separates the two readings cleanly: under the code the points term
  // survives, under the multiplied reading the whole product collapses to zero
  // (1.528 against 0.736 for this fixture). The comment has since been
  // corrected; this keeps the two from drifting apart again.
  it("adds the points term to the assists term rather than multiplying", () => {
    const noAssists = calculatePlayerValue(
      player({ assistsPerGame: 0, usageRate: 0 }),
    );

    const pointsTermSurvives = (30 * 0.66 + 1.2 * 12 + 3 + 6 - 2 - 3) / 25;
    expect(noAssists).toBeCloseTo(0.5 * pointsTermSurvives, 10);
    expect(noAssists).toBeGreaterThan(0);
  });

  // Early in a season, and for any team row the scraper failed to read, games
  // played can be zero. Without the guards this is a division by zero twice
  // over, and the NaN propagates through the sort — NaN comparisons are all
  // false, so the ranking silently stops sorting rather than visibly breaking.
  //
  // Since version 2 the result is exactly zero, not half the stats term:
  // availability multiplies the whole score, and nobody has played a game yet.
  // Every player tying at zero on day one is the honest answer, and a board of
  // zeroes is far more visible than a board of plausible-looking numbers built
  // from a team record that failed to scrape.
  it("returns zero when the team has played no games", () => {
    const value = calculatePlayerValue(
      player({ teamGamesPlayed: 0, teamWins: 0, gamesPlayed: 0 }),
    );

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(0);
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

// ───────────────────────────────────────────────────────────────────────────
// Availability
// ───────────────────────────────────────────────────────────────────────────
//
// Formula version 2 added the availability factor: a player's score scales with
// the share of his team's games he was actually there for.
//
// Absence is penalised twice, deliberately. VORP and Win Shares are cumulative,
// so they already stop accruing while a player sits; the availability factor
// compounds that. The alternative — switching Quality of Impact to rate stats
// so each factor is counted once — was considered and rejected, because MVP
// voting genuinely does punish missed games harder than proportionally.
//
// The three tests marked "regression" below replaced `it.fails` placeholders
// written while version 1 was still live. Their numbers are the whole point of
// the change, so they are asserted rather than characterised.

/** Same per-game production, but VORP and Win Shares scaled by games played. */
function withAvailability(gamesPlayed: number, teamGames: number) {
  const share = gamesPlayed / teamGames;
  return player({
    gamesPlayed,
    teamGamesPlayed: teamGames,
    // VORP and Win Shares are cumulative, so they accrue only while playing.
    valueOverReplacement: 6 * share,
    winShare: 10 * share,
    // Box plus/minus is a per-100-possessions rate: absence does not move it.
    boxPlusMinus: 12,
    // Every per-game stat is computed over games PLAYED, so they are unchanged.
  });
}

describe("availability", () => {
  const ironMan = withAvailability(55, 55);
  const injured = withAvailability(25, 55);

  // The scraper reads data-stat="games" from the per-game row, verified against
  // live markup. Without this field no availability rule can exist at all, so
  // this guards the schema rather than any arithmetic.
  it("carries the player's own games played", () => {
    expect(Object.keys(FullPlayerSummarySchema.shape)).toContain("gamesPlayed");
  });

  // Regression, and the headline number. Under version 1 this ratio was 0.845:
  // a player available for 45% of his team's games scored 84.5% of an
  // ever-present peer with identical rate production. It is now 0.384 —
  // deliberately HARSHER than simply pro-rating him (0.455), because absence is
  // penalised twice: cumulative VORP and Win Shares stop accruing while he
  // sits, and availability scales the result on top of that.
  it("penalises absence harder than pro-rating", () => {
    const full = calculatePlayerValue(ironMan);
    const partial = calculatePlayerValue(injured);
    const share = 25 / 55;

    expect(partial / full).toBeLessThan(share);
    expect(partial / full).toBeCloseTo(0.384, 3);
  });

  // An intermediate case, to pin the shape of the curve rather than one point
  // on it. Guards against a change that happens to hit 0.384 at 25 games while
  // behaving wrongly everywhere else.
  it("scales monotonically with games played", () => {
    const scores = [55, 45, 35, 25, 15].map((g) =>
      calculatePlayerValue(withAvailability(g, 55)),
    );

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  // Regression, and the perverse case. Team record enters as
  // teamWins / teamGamesPlayed, so under version 1 a team that kept winning
  // while its star sat actually RAISED that star's score (1.724 -> 1.748).
  // Availability now falls faster than the win ratio rises.
  it("does not credit a player for wins he was absent for", () => {
    const before = calculatePlayerValue(
      player({ teamWins: 30, teamGamesPlayed: 45, gamesPlayed: 45 }),
    );
    // Ten more team games, eight more wins, and the player appeared in none of
    // them: same minutes per game, same usage, same cumulative advanced stats.
    const after = calculatePlayerValue(
      player({ teamWins: 38, teamGamesPlayed: 55, gamesPlayed: 45 }),
    );

    expect(after).toBeLessThan(before);
  });

  // A player who never sat must be unaffected, since availability is exactly 1.
  // Guards against the factor being applied as a penalty to everyone — the kind
  // of off-by-one that would deflate the whole board uniformly and therefore
  // change no ranks, making it invisible.
  it("leaves an ever-present player's score unchanged", () => {
    const alwaysAvailable = player({ gamesPlayed: 55, teamGamesPlayed: 55 });

    const levelOfImpact = (38 / 55) * (36 / 48) * (30 / 100);
    const qualityOfImpact = 0.4 * (6 + 10) + 0.2 * 12;
    const totalStats =
      (30 * 0.66 + 1.5 * 10 + 1.2 * 12 + 3 * 1 + 3 * 2 - 2 - 3) / 25;

    expect(calculatePlayerValue(alwaysAvailable)).toBeCloseTo(
      0.5 * levelOfImpact * qualityOfImpact + 0.5 * totalStats,
      10,
    );
  });

  // Availability scales BOTH halves, which is the whole reason it multiplies
  // the total rather than sitting inside Level of Impact. Total Stats is built
  // from per-game rates and is the larger half; leaving it immune is what made
  // version 1's blind spot so large. Guards against the factor being moved back
  // down into levelOfImpact, which reads as an equivalent refactor and is not.
  it("scales the Total Stats half too", () => {
    // Zeroing usage removes the win-contribution half, leaving only Total Stats.
    const fullStatsHalf = calculatePlayerValue({ ...ironMan, usageRate: 0 });
    const partialStatsHalf = calculatePlayerValue({ ...injured, usageRate: 0 });

    expect(partialStatsHalf).toBeCloseTo(fullStatsHalf * (25 / 55), 10);
  });

  // Early season, and any row where the team scrape failed. Guards the same
  // divide-by-zero as the win ratio: NaN comparisons are all false, so a NaN
  // score would make the ranking sort silently stop sorting.
  it("returns a finite score when the team has played no games", () => {
    const value = calculatePlayerValue(
      player({ teamGamesPlayed: 0, teamWins: 0, gamesPlayed: 0 }),
    );

    expect(Number.isFinite(value)).toBe(true);
  });
});

describe("the stored row keeps the whole breakdown", () => {
  // Zod strips unknown keys. If BreakdownSchema is missing a field that
  // scoreBreakdown() returns, that field is silently dropped on its way to
  // MongoDB — no error, no warning, just a column that is never written and a
  // front end that has to recompute it. That is precisely the gap that gave
  // this app two implementations of one formula.
  it("stores every term the formula computes", () => {
    const computed = Object.keys(scoreBreakdown(player()));
    const stored = Object.keys(BreakdownSchema.shape);

    expect(stored.sort()).toEqual(computed.sort());
  });

  // The round trip that matters: what comes out of calculateAllPlayerValues is
  // what Zod validated, so anything the schema does not know about is already
  // gone by the time this runs.
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
  // that do not add up to the total printed beside them — which it did, before
  // the hero card was fixed.
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

describe("formula version", () => {
  // Every stored row records which formula produced it. The app draws rank
  // deltas between consecutive days, which only means something if both days
  // were measured with the same ruler — this is what lets a formula change be
  // rendered as a discontinuity instead of as movement that never happened.
  it("stamps rows with the current formula version", () => {
    const [row] = calculateAllPlayerValues([player()]);

    expect(row.formulaVersion).toBe(CURRENT_FORMULA_VERSION);
  });

  // Guards against the constant being bumped without the availability work
  // being what bumped it. Version 2 IS availability; if this file ever needs a
  // version 3, this assertion should be updated deliberately.
  it("is on version 2, the availability revision", () => {
    expect(CURRENT_FORMULA_VERSION).toBe(2);
  });
});
