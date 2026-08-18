// The MVP scoring formula. This is the only place it is implemented.
//
// Total Value      = Availability * (0.5 Win Contribution + 0.5 Total Stats)
// Availability     = Player Games / Team Games
// Win Contribution = Level of Impact * Quality of Impact
// Level of Impact  = (Team Wins/Team Games) * (Minutes Per Game/48) * Usage
// Quality of Impact= 0.4(PIE * 100) + 0.2(Net Rating)
// Total Stats      = (Points * True Shooting % + 1.5(Assists) + 1.2(Rebounds)
//                     + 3(Blocks) + 3(Steals) - Fouls - Turnovers) / 25
//
// ── Scale: what is a fraction and what is not ────────────────────────────────
//
// Inputs come from the NBA stats API and are stored EXACTLY as received, so a
// stored row can always be diffed against the source. That means the formula
// owns every scaling decision, and they are not uniform:
//
//     usageRate                0.288   used directly, no division
//     pie                      0.214   scaled by 100 inside the formula
//     trueShootingPercentage   0.625   used as a decimal, unscaled
//     netRating               10.740   already points per 100, unscaled
//
// Applying one rule to all four is the failure this arrangement exists to
// prevent: multiplying true shooting by 100 inflates Total Stats sixty-fold and
// still produces a leaderboard that looks entirely reasonable.
//
// ── Why availability multiplies the whole score ──────────────────────────────
//
// Every other term is a rate. Minutes per game, usage, PIE, net rating and all
// seven Total Stats inputs are computed over games PLAYED, so none of them can
// tell a player who appeared 25 times from one who appeared 55. Total Stats is
// also the larger half. Putting availability inside Level of Impact left a
// player available for 45% of his team's games scoring 72% of an ever-present
// peer — a milder penalty than simply pro-rating him. At the top, that becomes
// 38%.
//
// Availability is now the ONLY term that notices absence. Under the previous
// formula VORP was cumulative and froze while a player sat, so absence was
// penalised twice; PIE and net rating are both rates and do not accrue. That
// makes this multiplier load-bearing rather than reinforcing.
//
// ── Why this file has no imports ─────────────────────────────────────────────
//
// It is loaded by the Node scraper AND bundled into the browser. Importing the
// pino logger or the Zod schemas from here would ship both to the client (~60 kB
// gzipped, measured). Keep this module free of runtime imports; callers own
// their own logging and validation.
//
// It previously existed as three hand-written copies — the backend, the front
// end's breakdown(), and again inside the front end's snapshot builder. Adding
// availability updated two of the three, and the leaderboard silently ranked
// players with the factor having no effect at all. Types, both builds and every
// test were green throughout.

/**
 * The numbers the formula needs, and nothing else.
 *
 * Deliberately not `FullPlayerSummary` (Zod-derived, backend) or `PlayerStats`
 * (front end) — neither is a subtype of the other, and this module must not
 * depend on either. Both satisfy this shape structurally, so callers pass their
 * own type with no conversion.
 */
export type ScoringInput = {
  teamWins: number;
  teamGamesPlayed: number;
  gamesPlayed: number;
  minutesPerGame: number;
  /**
   * Usage as the NBA API returns it — a FRACTION (0.288), not a percentage.
   * It is used as the usage factor directly, with no division.
   */
  usageRate: number;
  /**
   * Player Impact Estimate, also a fraction (0.214). Scaled by 100 inside the
   * formula so it reaches the same magnitude as net rating.
   */
  pie: number;
  /** Offensive rating minus defensive rating, already points per 100. */
  netRating: number;
  pointsPerGame: number;
  assistsPerGame: number;
  reboundsPerGame: number;
  blocksPerGame: number;
  stealsPerGame: number;
  foulsPerGame: number;
  turnoversPerGame: number;
  trueShootingPercentage: number;
};

/** Every intermediate term, so the UI can show its working. */
export type Breakdown = {
  teamWinRatio: number;
  availability: number;
  minutesFactor: number;
  usageFactor: number;
  levelOfImpact: number;
  qualityOfImpact: number;
  winContribution: number;
  totalStats: number;
  /** Before availability — what the score would be at full health. */
  rawValue: number;
  mvpValue: number;
};

/**
 * Coerce a possibly-absent number to 0.
 *
 * The backend validates with Zod before scoring, so nothing should be missing
 * there. The front end's API source does NOT validate — it reads Mongo
 * documents straight off the wire — so a malformed row would otherwise turn one
 * field into NaN and, because NaN comparisons are all false, stop the ranking
 * sort from sorting rather than failing visibly.
 */
function num(value: number | null | undefined): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : 0;
}

/**
 * Combine the three top-level terms into a final score.
 *
 * Exported separately because the front end's fixture perturbs
 * `winContribution` and `totalStats` to simulate day-to-day drift and then has
 * to recombine them. That recombination was the third hand-written copy of the
 * formula; it now calls this.
 */
export function combine(
  availability: number,
  winContribution: number,
  totalStats: number,
): number {
  return availability * (0.5 * winContribution + 0.5 * totalStats);
}

/** The formula, with every intermediate term exposed. */
export function scoreBreakdown(player: ScoringInput): Breakdown {
  const teamGames = num(player.teamGamesPlayed);

  // Both ratios guard division by zero: a team with no games played yet (day
  // one of a season, or a team row the scraper failed to read) must not produce
  // NaN and poison the ranking sort.
  const teamWinRatio = teamGames > 0 ? num(player.teamWins) / teamGames : 0;
  const availability = teamGames > 0 ? num(player.gamesPlayed) / teamGames : 0;

  const minutesFactor = num(player.minutesPerGame) / 48;

  // Usage is used with no division. The NBA API returns it as a fraction
  // (0.288) which IS the factor; the old `/ 100` existed only because
  // Basketball Reference returned 28.8. Dividing again is a 100x error that
  // still produces a plausible ranked list.
  const usageFactor = num(player.usageRate);

  const levelOfImpact = teamWinRatio * minutesFactor * usageFactor;

  // PIE also arrives as a fraction and is scaled by 100 here so it reaches the
  // same magnitude as net rating. Left unscaled it would contribute under 4% of
  // this term instead of ~80%, and the score would collapse into net rating
  // with a rounding error attached.
  //
  // The `× 100` deliberately sits INSIDE the parentheses. Folding it into the
  // coefficient as `40 * pie` is arithmetically identical but hides the
  // 0.4-to-0.2 weighting, and a future retune to 0.5 would mean writing 50.
  //
  // True shooting is NOT scaled — it is used as a decimal in totalStats below.
  // A blanket "multiply the fractions by 100" inflates that term sixty-fold.
  const qualityOfImpact = 0.4 * (num(player.pie) * 100) + 0.2 * num(player.netRating);

  const winContribution = levelOfImpact * qualityOfImpact;

  const totalStats =
    (num(player.pointsPerGame) * num(player.trueShootingPercentage) +
      1.5 * num(player.assistsPerGame) +
      1.2 * num(player.reboundsPerGame) +
      3 * num(player.blocksPerGame) +
      3 * num(player.stealsPerGame) -
      num(player.foulsPerGame) -
      num(player.turnoversPerGame)) /
    25;

  return {
    teamWinRatio,
    availability,
    minutesFactor,
    usageFactor,
    levelOfImpact,
    qualityOfImpact,
    winContribution,
    totalStats,
    rawValue: 0.5 * winContribution + 0.5 * totalStats,
    mvpValue: combine(availability, winContribution, totalStats),
  };
}

/** Just the score. */
export function scoreOf(player: ScoringInput): number {
  return scoreBreakdown(player).mvpValue;
}
