// The MVP scoring formula. This is the only place it is implemented — imported
// by both the backend and the browser.
//
// Total Value      = Availability * (0.5 Win Contribution + 0.5 Total Stats)
// Availability     = Player Games / Team Games
// Win Contribution = Level of Impact * Quality of Impact
// Level of Impact  = (Team Wins/Team Games) * (Minutes Per Game/48) * Usage
// Quality of Impact= 0.4(PIE * 100) + 0.2(Net Rating)
// Total Stats      = (Points * True Shooting % + 1.5(Assists) + 1.2(Rebounds)
//                     + 3(Blocks) + 3(Steals) - Fouls - Turnovers) / 25
//
// Inputs are stored exactly as the NBA API returns them, so this file owns every
// scaling decision — and they are not uniform:
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
// Availability multiplies the whole score because every other term is a rate
// computed over games PLAYED — none of them can tell a player who appeared 25
// times from one who appeared 55. It is the only term that notices absence.
//
// Keep this module free of runtime imports: it is bundled into the browser, and
// importing the logger or the Zod schemas would ship ~60 kB gzipped with it.

/**
 * The numbers the formula needs, and nothing else.
 *
 * Deliberately neither the backend's Zod-derived type nor the front end's —
 * neither is a subtype of the other, and this module must not depend on either.
 * Both satisfy this shape structurally, so callers pass their own type.
 */
export type ScoringInput = {
  teamWins: number;
  teamGamesPlayed: number;
  gamesPlayed: number;
  minutesPerGame: number;
  /** A FRACTION (0.288), used as the usage factor directly. */
  usageRate: number;
  /** Also a fraction (0.214). Scaled by 100 inside the formula. */
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
 * The front end reads Mongo documents straight off the wire without validating,
 * so a malformed row would otherwise turn one field into NaN and — because NaN
 * comparisons are all false — stop the ranking sort from sorting rather than
 * failing visibly.
 */
function num(value: number | null | undefined): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : 0;
}

/**
 * Combine the three top-level terms into a final score. Exported because the
 * front end's fixture perturbs the two halves and has to recombine them.
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

  // Both ratios guard division by zero: a team with no games played yet must
  // not produce NaN and poison the ranking sort.
  const teamWinRatio = teamGames > 0 ? num(player.teamWins) / teamGames : 0;
  const availability = teamGames > 0 ? num(player.gamesPlayed) / teamGames : 0;

  const minutesFactor = num(player.minutesPerGame) / 48;

  // No division. The API's fraction IS the factor; the old `/ 100` existed only
  // because Basketball Reference returned 28.8. Dividing again is a 100x error
  // that still produces a plausible ranked list.
  const usageFactor = num(player.usageRate);

  const levelOfImpact = teamWinRatio * minutesFactor * usageFactor;

  // Unscaled, PIE would contribute under 4% of this term instead of ~80% and
  // the score would collapse into net rating. The `× 100` sits inside the
  // parentheses so the 0.4-to-0.2 weighting stays legible; folding it into the
  // coefficient as `40 * pie` is identical arithmetic and worse to retune.
  const qualityOfImpact = 0.4 * (num(player.pie) * 100) + 0.2 * num(player.netRating);

  const winContribution = levelOfImpact * qualityOfImpact;

  // True shooting is NOT scaled here — a blanket "multiply the fractions by
  // 100" inflates this term sixty-fold.
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
