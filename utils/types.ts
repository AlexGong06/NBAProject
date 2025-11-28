import { z } from "zod";

// export schemas here

export const FullPlayerSummarySchema = z.object({
  player: z.string(),
  profileUrl: z.string().url(),
  team: z.string(),
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
  usageRate: z.number(),
  valueOverReplacement: z.number(),
  winShare: z.number(),
  boxPlusMinus: z.number(),
  trueShootingPercentage: z.number(),
});

// Equivalent TS type (exactly like your interface)
export type FullPlayerSummary = z.infer<typeof FullPlayerSummarySchema>;

export const PlayerWithCalculatedMvpValueSchema =
  FullPlayerSummarySchema.extend({
    mvpValue: z.number(),
    calculatedRank: z.number(),
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
