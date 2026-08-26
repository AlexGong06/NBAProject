// Shared shapes for both data sources (fixture and live API).

export type PlayerStats = {
  player: string;
  team: string;
  /** Null for players the bio endpoint did not cover; the UI omits them. */
  pos: string | null;
  age: number | null;
  teamWins: number;
  teamLosses: number;
  teamGamesPlayed: number;
  /** Games the player appeared in. Over teamGamesPlayed, the availability factor. */
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
   * FRACTIONS, not percentages: `usageRate` 0.288, `pie` 0.214,
   * `trueShootingPercentage` 0.625 — stored exactly as the API sent them, so
   * anything displaying them as a percentage multiplies by 100 itself.
   * `netRating` is the exception: already points per 100 possessions.
   */
  usageRate: number;
  pie: number;
  netRating: number;
  trueShootingPercentage: number;
};

// Re-exported from the shared module rather than restated: a second declaration
// would let the UI describe a shape the formula no longer returns. Imported as
// well, because `export ... from` does not bring the name into scope.
import type { Breakdown } from "../../../shared/mvp-formula";
export type { Breakdown };

export type DateInfo = {
  key: string; // "2-17-2026" — matches the API's :date param
  short: string; // "Feb 17"
  iso: string; // "2026-02-17"
  long: string; // "Feb 17, 2026"
  weekday: string;
};

/** A row exactly as the backend stored it. The front end reads, never derives. */
export type StoredRow = PlayerStats &
  Breakdown & {
    date: string;
    /** ISO "YYYY-MM-DD" twin of `date`, sortable as text. */
    isoDate?: string;
    formulaVersion?: number;
    /**
     * The two sources carry different subsets: the API returns `playerId`, the
     * committed fixture keeps only `profileUrl` — whose path holds the same id.
     * `headshotUrl()` reads whichever is present.
     */
    playerId?: number;
    profileUrl?: string;
    /** Absent from the fixture, which predates the game view. */
    lastGame?: LastGame | null;
  };

/**
 * The most recent game a player played, **as of the date its row belongs to**.
 *
 * A chip showing a player's latest game regardless of the date being viewed
 * would report an April game on a November board — the same error as a rank
 * that ignored its date. Rides along on the board response, so 50 rows cost no
 * extra requests; the full game comes from `loadGame`.
 */
export type LastGame = {
  gameId: string;
  /** "M-D-YYYY", matching the app's other date keys. */
  date: string;
  isoDate: string;
  teamAbbr: string;
  teamId: number;
  opponentAbbr: string;
  opponentTeamId: number;
  /** Meaningless when `neutralSite`, where neither team hosted. */
  home: boolean;
  neutralSite: boolean;
  teamScore: number;
  opponentScore: number;
  win: boolean;
  overtime: boolean;
  /** Whether a highlight reel resolved. False is a real answer. */
  hasHighlight: boolean;
  /** His line in *that game*, not his season averages. */
  points: number;
  rebounds: number;
  assists: number;
};

/** One player's row in a game's box score. */
export type BoxScoreRow = {
  playerId: number;
  player: string;
  teamId: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  /** Already formatted as "8-23" — makes and attempts, not a ratio. */
  fieldGoals: string;
  threes: string;
  freeThrows: string;
  plusMinus: number;
};

export type Highlight = {
  videoId: string;
  title: string;
  channel: string;
  durationLabel: string;
};

/**
 * One game, reported from one player's side — `team`, the scores and `win` are
 * all relative to the player whose profile is open, which is why the endpoints
 * take a player as well as a game id.
 */
export type PlayerGame = {
  gameId: string;
  /** "M-D-YYYY", the key form the rest of the app queries by. */
  date: string;
  isoDate: string;
  team: string;
  teamId: number;
  opponent: string;
  opponentTeamId: number;
  /** Meaningless when `neutralSite` — see LastGame. */
  home: boolean;
  neutralSite: boolean;
  teamScore: number;
  opponentScore: number;
  win: boolean;
  overtime: boolean;
  overtimePeriods: number;
  /** Q1-Q4 and any overtime periods, for each side. */
  quarters: { team: number[]; opponent: number[] };
  line: {
    minutes: number;
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fieldGoals: string;
    threes: string;
    freeThrows: string;
    trueShooting: number;
    plusMinus: number;
  };
  /** Both rosters, the tracked player first. */
  box: BoxScoreRow[];
  /** Null when no reel resolved — a real answer, not a loading state. */
  highlight: Highlight | null;
  /** Position in this player's season, for "Game 60 of 65". */
  number: number;
  of: number;
  /** `nextGameId` is bounded by the date being viewed, so stepping cannot leave
   *  the panel describing a game the header has not reached. */
  prevGameId: string | null;
  nextGameId: string | null;
};

/**
 * A stored row with its position on the day it belongs to.
 *
 * `calculatedRank` lives here and not on `StoredRow` because rank is a property
 * of a player *within a date's field*, assigned on read. No rank is stored,
 * which is what lets the board be cut at any depth.
 */
export type RankedPlayer = StoredRow & {
  calculatedRank: number;
  /** Rank movement vs the previous day that actually has data. */
  delta: number;
};

/** One date's board — where rank comes into existence. */
export type Snapshot = {
  date: DateInfo;
  /** True when the NBA played no games that day. */
  noGames: boolean;
  rows: RankedPlayer[];
};

/**
 * One day in a player's history. Two different things leave `rank` null:
 *
 * - `noGames` belongs to the *date*. Values carry forward across these, so
 *   `rank` is normally non-null with `carried: true` and the chart runs flat.
 * - A null `rank` on a day with games belongs to the *player* — he had not
 *   debuted, or the loaded board never held him. Nothing is drawn.
 */
export type HistoryPoint = {
  date: DateInfo;
  noGames: boolean;
  /** True when this value was inherited from the previous game day. */
  carried: boolean;
  rank: number | null;
  score: number | null;
};

/**
 * The standings in effect on a date. `asOf` is the game day the rows actually
 * come from, which on an off day is earlier than the date asked for.
 */
export type Standings = {
  rows: RankedPlayer[];
  asOf: DateInfo;
  noGames: boolean;
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
 * One player in the search index. Search covers the whole league while the
 * board only loads a top N — 137 of 582 players reach a top 50 all season — so
 * carrying full rows for everyone would be most of a megabyte of unscored text.
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
 * The slice of one date's field surrounding a player, each row carrying its
 * true rank within the whole date.
 *
 * `complete` says whether those ranks are measured against the entire league.
 * The API can answer for all 582; the fixture holds a top 25 and reports false,
 * so the UI can decline to print a rank it cannot stand behind.
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
 * synchronously; the API adapter loads then serves from memory, so the
 * component tree stays identical either way.
 */
export type DataSource = {
  TEAMS: Record<string, string>;
  /** Each tracked player's most recent row, current leader first. */
  PLAYERS: RankedPlayer[];
  /** Every player in the league, for search — including ones never loaded. */
  ROSTER: RosterEntry[];
  /** Null when the source cannot supply it — a fixture search hit may have no
   *  profile behind it, and the UI has to say so rather than render blanks. */
  loadPlayerSeason(playerName: string): Promise<PlayerSeason | null>;
  /**
   * One date's field around a player. Separate from `rankings()`: that answers
   * "who leads on this date", this answers "where does *he* sit" — which the
   * board cannot answer for the ~445 players it never loads.
   */
  fieldAround(
    playerName: string,
    dateKey: string,
    window: number,
  ): Promise<FieldWindow | null>;
  /**
   * A player's stored row on one specific date.
   *
   * Reads the fetched season first and the loaded board second: the board holds
   * a player only on the dates he cracked the top N, and treating one of those
   * as his current form is how a one-game November spike came to be displayed
   * as a season-long rank.
   */
  rowFor(playerName: string, dateKey: string): RankedPlayer | null;
  /** The most recent game on or before `dateKey` — not simply "his last game",
   *  which would report an April game under a November header. */
  loadLastGame(playerName: string, dateKey: string): Promise<PlayerGame | null>;
  /** One specific game, for prev/next stepping and deep links. */
  loadGame(playerName: string, gameId: string): Promise<PlayerGame | null>;
  DATES: DateInfo[];
  /** Dates the NBA played no games on. Ten of them in 2025-26. */
  NO_GAME_DAYS: Set<string>;
  TODAY_KEY: string;
  snapshot(dateKey: string): Snapshot | null;
  dateIndex(dateKey: string): number;
  previousWithData(dateKey: string): Snapshot | null;
  /** Game days closest to this date, nearest first — for jumping off an off day. */
  nearestGameDays(dateKey: string, count: number): DateInfo[];
  /** The game day whose standings are in effect: itself, or the most recent
   *  game day before it. */
  effectiveDate(dateKey: string): DateInfo | null;
  /** Strict: null on a day with no games. Most callers want `standingsFor`. */
  rankings(dateKey: string): RankedPlayer[] | null;
  /** The standings in effect on a date, off days included. */
  standingsFor(dateKey: string): Standings | null;
  /**
   * Whether this date's full rows are in memory.
   *
   * `standingsFor` returns null both for an unfetched date and for a day with
   * no games; this tells them apart. Without it the UI renders an unfetched
   * Tuesday as a day nobody played.
   */
  isDateLoaded(dateKey: string): boolean;
  /** Fetch and cache one date's rows. Immediate when already held or no games. */
  ensureDate(dateKey: string): Promise<void>;
  history(playerName: string, dateKey: string, days: number): HistoryPoint[];
  findPlayer(name: string): RankedPlayer | undefined;
  nextGames(playerName: string): Game[];
};
