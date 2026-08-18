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
 * 3 — quality of impact becomes 0.4(PIE × 100) + 0.2(Net Rating), replacing
 *     VORP, Win Shares and BPM. Source moved from Basketball Reference to the
 *     NBA stats API, so rates are now stored as fractions and usage is no
 *     longer divided by 100. Absence is penalised once rather than twice,
 *     since PIE and net rating are rates and do not accrue.
 *
 * Rows written before this field existed have no version and are version 1.
 * Scores are only comparable within a version.
 */
export const CURRENT_FORMULA_VERSION = 3;

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

/**
 * One player's season-to-date figures and score on one date — a row of the
 * `PlayerDailyValues` collection.
 *
 * Deliberately NOT built on `FullPlayerSummarySchema`, which is the shape the
 * Basketball Reference scraper produced. That schema carries fields the NBA
 * game logs cannot supply (`gamesStarted`) and omits ones they can
 * (`playerId`, possession totals). Reusing it would have meant inventing a
 * value for the first — and a fabricated zero is indistinguishable from a real
 * one once stored.
 *
 * ── No rank is stored ──────────────────────────────────────────────────────
 *
 * Rank is a property of a date's whole field, not of a player, and it is
 * computed when a date is read. Storing it would mean every row on a date has
 * to be rewritten whenever any one of them changes, and a board that disagrees
 * with itself the moment that half-succeeds. Not storing it is also what makes
 * "top 10 / top 50 / whole league" a query parameter rather than a migration.
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
