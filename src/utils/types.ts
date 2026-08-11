import { z } from "zod";

// export schemas here

export const FullPlayerSummarySchema = z.object({
  player: z.string(),
  profileUrl: z.string().url(),
  team: z.string(),
  pos: z.string(),
  age: z.number(),
  teamWins: z.number(),
  teamLosses: z.number(),
  teamGamesPlayed: z.number(),
  gamesStarted: z.number(),
  // Games the player appeared in, as of the scrape. Divided by teamGamesPlayed
  // this is the availability factor in the MVP formula — see
  // src/services/mvp-calculation/calculate-player-value.ts.
  gamesPlayed: z.number(),
  minutesPerGame: z.number(),
  pointsPerGame: z.number(),
  assistsPerGame: z.number(),
  reboundsPerGame: z.number(),
  blocksPerGame: z.number(),
  stealsPerGame: z.number(),
  foulsPerGame: z.number(),
  turnoversPerGame: z.number(),
  usageRate: z.number(),
  valueOverReplacement: z.number(),
  winShare: z.number(),
  boxPlusMinus: z.number(),
  trueShootingPercentage: z.number(),
});

// Equivalent TS type (exactly like your interface)
export type FullPlayerSummary = z.infer<typeof FullPlayerSummarySchema>;

/**
 * Which revision of the scoring formula produced a row's mvpValue.
 *
 * The app is a time series: it draws rank deltas and connects points across
 * days. That only means anything if consecutive days were measured with the
 * same ruler. Stamping the version is what lets a formula change be shown as a
 * discontinuity rather than rendered as movement that never happened.
 *
 * 1 — original. No availability term; a player was scored the same whether he
 *     appeared in every game or a third of them.
 * 2 — availability (gamesPlayed / teamGamesPlayed) scaling the whole score,
 *     not just the win half. Absence is penalised harder than pro-rating.
 *
 * Rows written before this field existed have no version and are version 1.
 */
export const CURRENT_FORMULA_VERSION = 2;

/**
 * Every intermediate term of the scoring formula, stored alongside the result.
 *
 * These are not extra work — `scoreBreakdown()` already computes all of them to
 * arrive at `mvpValue`. Previously only the final number was kept and the rest
 * were discarded, which forced the front end to re-run the whole formula from
 * the raw stats just to show a player's win-contribution split. That gave the
 * app two independent implementations of one calculation, and they drifted.
 *
 * Storing them makes the browser a pure view layer: nothing on screen is
 * derived from anything except these fields.
 *
 * Keys must match the `Breakdown` type in the formula module — there is a test
 * asserting exactly that, since a schema silently missing a field would be
 * stripped by Zod on the way to MongoDB.
 */
export const BreakdownSchema = z.object({
  teamWinRatio: z.number(),
  availability: z.number(),
  minutesFactor: z.number(),
  usageFactor: z.number(),
  levelOfImpact: z.number(),
  qualityOfImpact: z.number(),
  winContribution: z.number(),
  totalStats: z.number(),
  /** Before availability is applied — the score at full health. */
  rawValue: z.number(),
  mvpValue: z.number(),
});

export const PlayerWithCalculatedMvpValueSchema = FullPlayerSummarySchema.extend(
  BreakdownSchema.shape,
).extend({
  calculatedRank: z.number(),
  formulaVersion: z.number(),
});

export type PlayerWithCalculatedMvpValue = z.infer<
  typeof PlayerWithCalculatedMvpValueSchema
>;

export const PlayerMvpSummarySchema = z.object({
  websiteRanking: z.string(),
  player: z.string(),
  profileUrl: z.string().url(),
  teamWins: z.number(),
  teamGamesPlayed: z.number(),
  gamesStarted: z.number(),
  minutesPerGame: z.number(),
  pointsPerGame: z.number(),
  assistsPerGame: z.number(),
  reboundsPerGame: z.number(),
  blocksPerGame: z.number(),
  stealsPerGame: z.number(),
  foulsPerGame: z.number(),
  turnoversPerGame: z.number(),
});

export type PlayerMvpSummary = z.infer<typeof PlayerMvpSummarySchema>;

export const PpgPlayerSummarySchema = z.object({
  player: z.string(),
  profileUrl: z.string(),
  pointsPerGame: z.number(),
});

export const PpgPlayerSummaryArraySchema = z.array(PpgPlayerSummarySchema);

export type PpgPlayerSummary = z.infer<typeof PpgPlayerSummarySchema>;

export const PlayerSummaryFromDatabaseSchema =
  PlayerWithCalculatedMvpValueSchema.extend({
    date: z.string(),
  });

export type PlayerSummaryFromDatabase = z.infer<
  typeof PlayerSummaryFromDatabaseSchema
>;
