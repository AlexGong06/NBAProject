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
  /**
   * Rates as the NBA stats API returns them — FRACTIONS, not percentages:
   * `usageRate` 0.288, `pie` 0.214, `trueShootingPercentage` 0.625. Stored
   * exactly as received so a row can be diffed against the source, which means
   * anything displaying them as a percentage must multiply by 100 itself.
   *
   * `netRating` is the exception: already points per 100 possessions.
   */
  usageRate: number;
  pie: number;
  netRating: number;
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
    /** ISO "YYYY-MM-DD" twin of `date`, sortable as text. */
    isoDate?: string;
    formulaVersion?: number;
    /**
     * The NBA's player id, and the nba.com profile link that embeds it.
     *
     * Optional because the two sources carry different subsets: the API returns
     * `playerId` outright, while the committed fixture drops it and keeps only
     * `profileUrl` — whose path contains the same id. `headshotUrl()` reads
     * whichever is present, so headshots work offline and online alike.
     */
    playerId?: number;
    profileUrl?: string;
  };

/**
 * A stored row with its position on the day it belongs to.
 *
 * `calculatedRank` lives here and not on `StoredRow` because rank is not a
 * property of a player — it is a property of a player within a date's field,
 * and it is assigned on read by `buildDataSource`. The database stores no rank
 * at all, which is what allows the board to be cut at any depth: top 10, top
 * 50, or the whole league, all from the same rows.
 */
export type RankedPlayer = StoredRow & {
  calculatedRank: number;
  /** Rank movement vs the previous day that actually has data. */
  delta: number;
};

/**
 * One date's board. `rows` are RankedPlayer because a snapshot is precisely
 * where rank comes into existence — `buildDataSource` sorts the date's stored
 * rows by score and numbers them.
 */
export type Snapshot = {
  date: DateInfo;
  missing: boolean;
  rows: RankedPlayer[];
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
 * One player in the search index — enough to list and identify, nothing more.
 *
 * Search has to cover the whole league, but the board only ever loads a top N
 * per date: just 137 of 582 players reach a top 50 all season. Carrying full
 * rows for everyone to support a name search would be most of a megabyte for
 * text nobody scores on.
 */
export type RosterEntry = {
  player: string;
  team: string;
  pos: string | null;
  pointsPerGame: number;
  mvpValue: number;
  /** True when this player is in the loaded board and needs no extra fetch. */
  loaded: boolean;
  /** Enough to build a headshot URL. See the note on StoredRow. */
  playerId?: number;
  profileUrl?: string;
};

/** A player's season, fetched on demand for someone outside the loaded board. */
export type PlayerSeason = {
  current: RankedPlayer;
  history: HistoryPoint[];
};

/**
 * The slice of one date's field surrounding a player.
 *
 * `rows` is the player with his neighbours above and below, each carrying its
 * true rank within the whole date — not a position within this window.
 *
 * `complete` says whether those ranks are measured against the entire league.
 * The API can answer for all 582; the offline fixture only holds a top 25, so
 * it reports false and the UI can decline to print a rank it cannot stand
 * behind. A rank out of 25 shown as a rank out of 582 is exactly the confusion
 * this window exists to end.
 */
export type FieldWindow = {
  /** The player's rank on this date. */
  rank: number;
  /** How many players have a row on this date — the "of N" in "#20 of N". */
  fieldSize: number;
  rows: RankedPlayer[];
  complete: boolean;
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
  /**
   * Every player in the league, for search — including the ones the board never
   * loaded. In fixture mode this is only what the fixture contains.
   */
  ROSTER: RosterEntry[];
  /**
   * A player's full season, fetched on demand and cached.
   *
   * Returns null when the source cannot supply it — the offline fixture holds
   * only the players who reached a top 25, so a search hit there may have no
   * profile behind it, and the UI has to say so rather than render blanks.
   */
  loadPlayerSeason(playerName: string): Promise<PlayerSeason | null>;
  /**
   * One date's field around a player, `window` rows either side.
   *
   * Separate from `rankings()` because that answers "who leads on this date",
   * cut from the loaded board, while this answers "where does *he* sit" — a
   * question the board cannot answer for the ~445 players it never loads.
   * Returns null when the player has no row on that date, which for most of the
   * league means he had not debuted yet.
   */
  fieldAround(
    playerName: string,
    dateKey: string,
    window: number,
  ): Promise<FieldWindow | null>;
  /**
   * A player's stored row on one specific date.
   *
   * The profile is a function of a date, so every number it prints comes from
   * here. Reads the fetched season first and the loaded board second: the board
   * holds a player only on the dates he cracked the top N, and treating one of
   * those rows as his current form is how a one-game November spike came to be
   * displayed as a season-long rank.
   */
  rowFor(playerName: string, dateKey: string): RankedPlayer | null;
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
