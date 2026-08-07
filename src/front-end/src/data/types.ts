// Shared shapes for both data sources (fixture and live API).

export type PlayerStats = {
  player: string;
  team: string;
  pos: string;
  age: number;
  teamWins: number;
  teamLosses: number;
  teamGamesPlayed: number;
  gamesStarted: number;
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

/** The pieces of the MVP formula, kept separate so the UI can show the math. */
export type Breakdown = {
  teamWinRatio: number;
  minutesFactor: number;
  usageFactor: number;
  levelOfImpact: number;
  qualityOfImpact: number;
  winContribution: number;
  totalStats: number;
  mvpValue: number;
};

export type DateInfo = {
  key: string; // "2-17-2026" — matches the API's :date param
  short: string; // "Feb 17"
  iso: string; // "2026-02-17"
  long: string; // "Feb 17, 2026"
  weekday: string;
};

export type RankedPlayer = PlayerStats &
  Breakdown & {
    calculatedRank: number;
    date: string;
    /** Rank movement vs the previous day that actually has data. */
    delta: number;
  };

export type Snapshot = {
  date: DateInfo;
  missing: boolean;
  rows: (PlayerStats & Breakdown & { calculatedRank: number; date: string })[];
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
  PLAYERS: PlayerStats[];
  DATES: DateInfo[];
  MISSING: Set<string>;
  TODAY_KEY: string;
  breakdown(p: PlayerStats): Breakdown;
  snapshot(dateKey: string): Snapshot | null;
  dateIndex(dateKey: string): number;
  previousWithData(dateKey: string): Snapshot | null;
  nearestWithData(dateKey: string, count: number): DateInfo[];
  rankings(dateKey: string): RankedPlayer[] | null;
  history(playerName: string, dateKey: string, days: number): HistoryPoint[];
  findPlayer(name: string): PlayerStats | undefined;
  nextGames(playerName: string): Game[];
};
