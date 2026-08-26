// Fetches a whole season of player and team game logs.
//
// Three calls, roughly 20 seconds, for every player-game in a season. There is
// no per-game or per-player iteration: `playergamelogs` returns the entire
// league's game logs in one response, which is why ingesting a finished season
// is a sub-minute job rather than an hour of polite scraping.
//
// Nothing here transforms a value. Rates arrive as fractions (`USG_PCT: 0.288`)
// and are stored exactly as received, so a stored row can always be diffed
// against the API. The formula absorbs the scaling instead — see
// src/shared/mvp-formula.ts.

import { nbaStatsRows } from "./client";

/** Advanced measure type. Rates are fractions, not percentages. */
export type AdvancedGameRow = {
  PLAYER_ID: number;
  PLAYER_NAME: string;
  TEAM_ID: number;
  TEAM_ABBREVIATION: string;
  GAME_ID: string;
  GAME_DATE: string;
  MATCHUP: string;
  WL: string | null;
  MIN: number | null;
  PIE: number | null;
  USG_PCT: number | null;
  TS_PCT: number | null;
  NET_RATING: number | null;
  OFF_RATING: number | null;
  DEF_RATING: number | null;
  POSS: number | null;
};

/**
 * Base (traditional) measure type — the raw counting stats.
 *
 * The endpoint returns 70 columns; these are the ones kept. The makes, the
 * rebound split and the plus-minus were added for the game view: a box score
 * cannot show "11-28 FG" from attempts alone, and the formula never needed
 * them. `rowsToObjects` was already carrying every column at runtime — this
 * type and `joinGameLogs` are what decided to drop them.
 */
export type BaseGameRow = {
  PLAYER_ID: number;
  GAME_ID: string;
  MIN: number | null;
  PTS: number | null;
  AST: number | null;
  REB: number | null;
  OREB: number | null;
  DREB: number | null;
  BLK: number | null;
  STL: number | null;
  PF: number | null;
  TOV: number | null;
  FGM: number | null;
  FGA: number | null;
  FG3M: number | null;
  FG3A: number | null;
  FTM: number | null;
  FTA: number | null;
  PLUS_MINUS: number | null;
};

export type TeamGameRow = {
  TEAM_ID: number;
  TEAM_ABBREVIATION: string;
  GAME_ID: string;
  GAME_DATE: string;
  WL: string | null;
};

/** One player-game: the two endpoints joined, values untouched. */
export type PlayerGame = {
  playerId: number;
  playerName: string;
  teamId: number;
  teamAbbr: string;
  gameId: string;
  /** ISO date only. The API sends "2026-04-12T00:00:00"; the suffix is stripped. */
  date: string;
  won: boolean | null;
  /**
   * Who he played and where, parsed from the API's `MATCHUP` string —
   * `"NOP @ MIN"` is away, `"TOR vs. BKN"` is home.
   *
   * The team's own abbreviation is already on `teamAbbr`, so only the opponent
   * and the side are kept. Null when the string does not parse, rather than
   * guessing a side.
   */
  opponentAbbr: string | null;
  isHome: boolean | null;
  minutes: number;
  possessions: number;
  pie: number;
  usageRate: number;
  trueShootingPercentage: number;
  netRating: number;
  offensiveRating: number;
  defensiveRating: number;
  points: number;
  assists: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  blocks: number;
  steals: number;
  fouls: number;
  turnovers: number;
  fieldGoalsMade: number;
  fieldGoalAttempts: number;
  threesMade: number;
  threeAttempts: number;
  freeThrowsMade: number;
  freeThrowAttempts: number;
  plusMinus: number;
};

export type TeamGame = {
  teamId: number;
  teamAbbr: string;
  gameId: string;
  date: string;
  won: boolean;
};

/**
 * Strip the time component from an NBA API date.
 *
 * The API sends `"2026-04-12T00:00:00"`. Comparing that against `"2026-04-12"`
 * as a string is TRUE for `<` and FALSE for `<=`-style filters that expect a
 * bare date, which silently drops the final day of any range — 64 games instead
 * of 65. Every date is reduced here, once, on the way in.
 */
export function isoDate(apiDate: string): string {
  return apiDate.slice(0, 10);
}

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * Split the API's `MATCHUP` string into opponent and side.
 *
 *   "NOP @ MIN"     → away at MIN
 *   "TOR vs. BKN"   → home against BKN
 *
 * The separator is the whole signal. Anything that does not match returns nulls
 * rather than defaulting to a side — a game silently labelled "home" is worse
 * than one labelled nothing, because nobody checks a plausible label.
 *
 * **`isHome` is not authoritative.** On a neutral-site game both sides read `@`
 * because neither is hosting; five 2025-26 games are like this. Anything
 * user-facing should read `GameSummaries2526`, which carries the scoreboard's
 * own assignment and a `neutralSite` flag. This is the fallback.
 */
export function parseMatchup(
  matchup: string | null | undefined,
): { opponentAbbr: string | null; isHome: boolean | null } {
  const m = matchup?.match(/^([A-Z]{3})\s+(@|vs\.)\s+([A-Z]{3})$/);
  if (!m) return { opponentAbbr: null, isHome: null };
  return { opponentAbbr: m[3], isHome: m[2] === "vs." };
}

const commonParams = (season: string) => ({
  Season: season,
  SeasonType: "Regular Season",
  LeagueID: "",
  PlayerID: "",
  TeamID: "",
  DateFrom: "",
  DateTo: "",
});

export async function fetchAdvancedGameLogs(season: string) {
  return nbaStatsRows<AdvancedGameRow>("playergamelogs", {
    ...commonParams(season),
    MeasureType: "Advanced",
  });
}

export async function fetchBaseGameLogs(season: string) {
  return nbaStatsRows<BaseGameRow>("playergamelogs", {
    ...commonParams(season),
    MeasureType: "Base",
  });
}

export async function fetchTeamGameLogs(season: string): Promise<TeamGame[]> {
  const rows = await nbaStatsRows<TeamGameRow>("teamgamelogs", {
    ...commonParams(season),
    MeasureType: "Base",
  });
  return rows.map((r) => ({
    teamId: r.TEAM_ID,
    teamAbbr: r.TEAM_ABBREVIATION,
    gameId: r.GAME_ID,
    date: isoDate(r.GAME_DATE),
    won: r.WL === "W",
  }));
}

/**
 * Join the Advanced and Base responses into one row per player-game.
 *
 * **The two endpoints return rows in different orders.** They must be matched on
 * `(PLAYER_ID, GAME_ID)`; zipping them by index silently pairs one player's
 * advanced stats with another's box score, and every downstream number is then
 * wrong but plausible.
 *
 * Zero-minute appearances are dropped. Minutes and possessions are the weights
 * every rolling average divides by, and a row contributing nothing to either
 * cannot influence a result — but it can turn a total into a zero denominator.
 */
export function joinGameLogs(
  advanced: AdvancedGameRow[],
  base: BaseGameRow[],
): PlayerGame[] {
  const baseByKey = new Map<string, BaseGameRow>();
  for (const b of base) baseByKey.set(`${b.PLAYER_ID}:${b.GAME_ID}`, b);

  const out: PlayerGame[] = [];
  for (const a of advanced) {
    const b = baseByKey.get(`${a.PLAYER_ID}:${a.GAME_ID}`);
    if (!b) continue;

    const minutes = n(a.MIN);
    if (minutes <= 0) continue;

    const { opponentAbbr, isHome } = parseMatchup(a.MATCHUP);

    out.push({
      playerId: a.PLAYER_ID,
      playerName: a.PLAYER_NAME,
      teamId: a.TEAM_ID,
      teamAbbr: a.TEAM_ABBREVIATION,
      gameId: a.GAME_ID,
      date: isoDate(a.GAME_DATE),
      won: a.WL === null ? null : a.WL === "W",
      opponentAbbr,
      isHome,
      minutes,
      possessions: n(a.POSS),
      pie: n(a.PIE),
      usageRate: n(a.USG_PCT),
      trueShootingPercentage: n(a.TS_PCT),
      netRating: n(a.NET_RATING),
      offensiveRating: n(a.OFF_RATING),
      defensiveRating: n(a.DEF_RATING),
      points: n(b.PTS),
      assists: n(b.AST),
      rebounds: n(b.REB),
      offensiveRebounds: n(b.OREB),
      defensiveRebounds: n(b.DREB),
      blocks: n(b.BLK),
      steals: n(b.STL),
      fouls: n(b.PF),
      turnovers: n(b.TOV),
      fieldGoalsMade: n(b.FGM),
      fieldGoalAttempts: n(b.FGA),
      threesMade: n(b.FG3M),
      threeAttempts: n(b.FG3A),
      freeThrowsMade: n(b.FTM),
      freeThrowAttempts: n(b.FTA),
      plusMinus: n(b.PLUS_MINUS),
    });
  }

  out.sort((x, y) => x.date.localeCompare(y.date));
  return out;
}

/**
 * Position, age and URL slug — the biographical fields the game logs do not
 * carry.
 *
 * None of these reach the formula; they are display only. They come from two
 * different endpoints because neither has all three: `playerindex` has POSITION
 * and PLAYER_SLUG but no age, `leaguedashplayerbiostats` has AGE but no
 * position. Both return exactly one row per player.
 */
export type PlayerBio = {
  position: string | null;
  age: number | null;
  slug: string | null;
};

type PlayerIndexRow = {
  PERSON_ID: number;
  PLAYER_SLUG: string | null;
  POSITION: string | null;
};

type BioStatsRow = {
  PLAYER_ID: number;
  AGE: number | null;
};

export async function fetchPlayerBios(
  season: string,
): Promise<Map<number, PlayerBio>> {
  const [index, bios] = await Promise.all([
    nbaStatsRows<PlayerIndexRow>("playerindex", {
      Season: season,
      LeagueID: "00",
      Historical: "0",
      TeamID: "0",
      College: "", Country: "", DraftPick: "", DraftRound: "", DraftYear: "",
      Height: "", PlayerPosition: "", Weight: "", Active: "",
    }),
    nbaStatsRows<BioStatsRow>("leaguedashplayerbiostats", {
      Season: season,
      SeasonType: "Regular Season",
      LeagueID: "00",
      PerMode: "PerGame",
    }),
  ]);

  const ageById = new Map(bios.map((b) => [b.PLAYER_ID, b.AGE]));

  const out = new Map<number, PlayerBio>();
  for (const row of index) {
    out.set(row.PERSON_ID, {
      position: row.POSITION || null,
      age: ageById.get(row.PERSON_ID) ?? null,
      slug: row.PLAYER_SLUG || null,
    });
  }
  return out;
}

export type Season = {
  season: string;
  playerGames: PlayerGame[];
  teamGames: TeamGame[];
};

/** Everything needed to score a season. Three requests. */
export async function fetchSeason(season: string): Promise<Season> {
  const [advanced, base, teamGames] = await Promise.all([
    fetchAdvancedGameLogs(season),
    fetchBaseGameLogs(season),
    fetchTeamGameLogs(season),
  ]);

  const playerGames = joinGameLogs(advanced, base);

  if (playerGames.length === 0) {
    throw new Error(`No player games returned for season ${season}`);
  }
  if (teamGames.length === 0) {
    throw new Error(`No team games returned for season ${season}`);
  }

  return { season, playerGames, teamGames };
}
