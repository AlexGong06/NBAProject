// Shared shapes for both data sources (fixture and live API).

export type PlayerStats = {
  player: string;
  team: string;
  /**
   * Position and age were added to the scraper after most rows were collected,
   * so historical rows carry null. The UI omits them rather than printing the
   * word "null" where a value should be.
   */
  pos: string | null;
  age: number | null;
  teamWins: number;
  teamLosses: number;
  teamGamesPlayed: number;
  gamesStarted: number;
  /** Games the player appeared in. Divided by teamGamesPlayed, the availability factor. */
  gamesPlayed: number;
  minutesPerGame: number;
  pointsPerGame: number;
  assistsPerGame: number;
  reboundsPerGame: number;
  blocksPerGame: number;
  stealsPerGame: number;
  foulsPerGame: number;
  turnoversPerGame: number;
  usageRate: number;
  valueOverReplacement: number;
  winShare: number;
  boxPlusMinus: number;
  trueShootingPercentage: number;
};

// The pieces of the MVP formula, kept separate so the UI can show the math.
// Re-exported from the shared module rather than restated here: a second
// declaration would let the UI describe a shape the formula no longer returns.
// Imported as well as re-exported, because a bare `export ... from` does not
// bring the name into this file's scope, and RankedPlayer below needs it.
import type { Breakdown } from "../../../shared/mvp-formula";
export type { Breakdown };

export type DateInfo = {
  key: string; // "2-17-2026" — matches the API's :date param
  short: string; // "Feb 17"
  iso: string; // "2026-02-17"
  long: string; // "Feb 17, 2026"
  weekday: string;
};

/**
 * A row exactly as the backend stored it: the scraped stats, every term of the
 * scoring formula, and which formula version produced them.
 *
 * The front end never recreates any of this — it is read, not derived.
 */
export type StoredRow = PlayerStats &
  Breakdown & {
    date: string;
    calculatedRank: number;
    formulaVersion?: number;
  };

export type RankedPlayer = StoredRow & {
  /** Rank movement vs the previous day that actually has data. */
  delta: number;
};

export type Snapshot = {
  date: DateInfo;
  missing: boolean;
  rows: StoredRow[];
};

/** One day in a player's history. rank/score are null on days the collector failed. */
export type HistoryPoint = {
  date: DateInfo;
  missing: boolean;
  rank: number | null;
  score: number | null;
};

export type Game = {
  id: string;
  dateShort: string;
  weekday: string;
  opp: string;
  oppName: string;
  home: boolean;
  vs: string;
  tip: string;
  arena: string;
  priceFrom: number;
};

/**
 * Everything the UI needs from a data source. The fixture implements this
 * synchronously; the API adapter loads once then serves from memory, so the
 * component tree can stay identical either way.
 */
export type DataSource = {
  TEAMS: Record<string, string>;
  /** Each tracked player's most recent row, current leader first. */
  PLAYERS: RankedPlayer[];
  DATES: DateInfo[];
  MISSING: Set<string>;
  TODAY_KEY: string;
  snapshot(dateKey: string): Snapshot | null;
  dateIndex(dateKey: string): number;
  previousWithData(dateKey: string): Snapshot | null;
  nearestWithData(dateKey: string, count: number): DateInfo[];
  rankings(dateKey: string): RankedPlayer[] | null;
  history(playerName: string, dateKey: string, days: number): HistoryPoint[];
  findPlayer(name: string): RankedPlayer | undefined;
  nextGames(playerName: string): Game[];
};
