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
  /**
   * Rates as the NBA stats API returns them — fractions, not percentages.
   * `usageRate` 0.288, `pie` 0.214, `trueShootingPercentage` 0.625. Values are
   * stored exactly as received so a row can be diffed against the source; the
   * scoring formula owns every scaling decision. See src/shared/mvp-formula.ts.
   */
  usageRate: z.number(),
  pie: z.number(),
  /** Offensive rating minus defensive rating, already points per 100. */
  netRating: z.number(),
  trueShootingPercentage: z.number(),
});

// Equivalent TS type (exactly like your interface)
export type FullPlayerSummary = z.infer<typeof FullPlayerSummarySchema>;

/**
 * Which revision of the scoring formula produced a row's mvpValue. The app
 * connects points across days, which only means anything if they were measured
 * with the same ruler — this is what lets a formula change read as a
 * discontinuity rather than as movement that never happened.
 *
 * 1 — no availability term.
 * 2 — availability scales the whole score, not just the win half.
 * 3 — quality of impact becomes 0.4(PIE × 100) + 0.2(Net Rating); source moved
 *     to the NBA stats API, so rates are fractions and usage is not divided.
 *
 * Unversioned rows are version 1. Scores compare only within a version.
 */
export const CURRENT_FORMULA_VERSION = 3;

/**
 * Every intermediate term of the scoring formula, stored alongside the result,
 * so the browser stays a pure view layer and never re-derives a score.
 *
 * Keys must match the `Breakdown` type in the formula module — a test asserts
 * exactly that, since a schema silently missing a field would have it stripped
 * by Zod on the way to MongoDB.
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

/**
 * One player's season-to-date figures and score on one date — a row of the
 * `PlayerDailyValues` collection.
 *
 * Deliberately NOT built on `FullPlayerSummarySchema`, the Basketball Reference
 * shape: it carries fields the NBA game logs cannot supply (`gamesStarted`) and
 * omits ones they can (`playerId`, possession totals). A fabricated zero is
 * indistinguishable from a real one once stored.
 *
 * **No rank is stored.** It is computed when a date is read, which is what
 * makes "top 10 / top 50 / whole league" a query parameter rather than a
 * migration.
 */
export const DailyValueRowSchema = z.object({
  /** "M-D-YYYY" — the query key the API and front end are built on. */
  date: z.string(),
  /** ISO "YYYY-MM-DD". Sortable as text, unlike `date`. */
  isoDate: z.string(),

  playerId: z.number(),
  player: z.string(),
  /** The team he played for most recently as of this date. */
  team: z.string(),
  teamId: z.number(),
  profileUrl: z.string().url(),
  /** Display only, and genuinely absent for some players — never faked. */
  pos: z.string().nullable(),
  age: z.number().nullable(),

  gamesPlayed: z.number(),
  teamGamesPlayed: z.number(),
  teamWins: z.number(),
  teamLosses: z.number(),

  minutesPerGame: z.number(),
  pointsPerGame: z.number(),
  assistsPerGame: z.number(),
  reboundsPerGame: z.number(),
  blocksPerGame: z.number(),
  stealsPerGame: z.number(),
  foulsPerGame: z.number(),
  turnoversPerGame: z.number(),

  /** Fractions, exactly as the API returns them. See mvp-formula.ts. */
  usageRate: z.number(),
  pie: z.number(),
  trueShootingPercentage: z.number(),
  /** Already points per 100 possessions. */
  netRating: z.number(),

  /** The denominators the rates above were weighted by — the sample size. */
  totalMinutes: z.number(),
  totalPossessions: z.number(),

  formulaVersion: z.number(),
}).extend(BreakdownSchema.shape);

export type DailyValueRow = z.infer<typeof DailyValueRowSchema>;
