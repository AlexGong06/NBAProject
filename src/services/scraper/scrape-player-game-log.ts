// Per-player game logs — how many games a player had appeared in on a date.
//
// The daily pipeline does not need this. A player's season row is cumulative,
// so a scrape on any day already reports that day's games played. This exists
// for history: rows collected before `gamesPlayed` was captured have no other
// way to recover it, and season-final totals cannot be applied backwards
// without claiming things about days that had not happened yet.
//
// No browser. The game-log page is plain server-rendered HTML — unlike the team
// page, whose tables sit inside HTML comments and are only revealed by
// Basketball Reference's own JavaScript. A fetch takes ~0.15s against ~2.5s for
// a Playwright page load, and it makes the parser a pure function over a
// string, so it can be tested against a saved page with no network at all.
//
// Two traps, both verified against live markup and both covered by tests:
//
//   1. The page carries TWO tables — `player_game_log_reg` and
//      `player_game_log_post`. The `ranker` column restarts at 1 for the
//      playoffs, so reading the whole document instead of scoping to the
//      regular-season table silently produces nonsense.
//
//   2. Counting rows is NOT games played. The log lists every team game,
//      including ones the player missed: Jokić has 82 rows and 65 games played
//      for 2026. `ranker` counts only games he appeared in, and on a missed
//      game it repeats its previous value rather than blanking — so it is the
//      running total, but it cannot be used to tell whether he played. The
//      career game number is blank on missed games; that is the signal.

import * as cheerio from "cheerio";
import logger from "../../utils/logger";

/** Basketball Reference asks for no more than ~20 requests a minute. */
export const POLITE_DELAY_MS = 3000;

export type GameLogEntry = {
  /** ISO "YYYY-MM-DD" — sortable as a string, unlike our M-D-YYYY keys. */
  date: string;
  /** Games the player had appeared in, counting this date. */
  gamesPlayedToDate: number;
  /** The team's game number in the season, counting this date. */
  teamGamesToDate: number;
  /** False on rows the player missed (DNP, inactive, suspended). */
  played: boolean;
  /**
   * Whether the team won. Present on missed games too — the log lists every
   * team game — which makes it a complete, independent record of the team's
   * season, usable to repair a row whose team scrape failed.
   */
  teamWon: boolean | null;
};

/** Turn a profile URL into its game-log URL for a season. */
export function gameLogUrl(profileUrl: string, season: string | number): string {
  // https://www.basketball-reference.com/players/j/jokicni01.html
  //   -> https://www.basketball-reference.com/players/j/jokicni01/gamelog/2026/
  return `${profileUrl.replace(/\.html?$/i, "")}/gamelog/${season}/`;
}

/**
 * Parse a game-log page.
 *
 * Pure — takes HTML, returns rows. Scoped to the regular-season table; the
 * playoff table on the same page is ignored on purpose.
 */
export function parseGameLog(html: string): GameLogEntry[] {
  const $ = cheerio.load(html);
  const table = $("#player_game_log_reg");
  if (table.length === 0) return [];

  const entries: GameLogEntry[] = [];
  let lastGamesPlayed = 0;

  // `td` rather than any cell: the table repeats its header every 20 rows and
  // those cells are `th`, so matching both would parse column labels as games.
  table.find("tbody tr").each((_, tr) => {
    const row = $(tr);
    const date = row.find("td[data-stat='date']").first().text().trim();
    if (!date) return;

    // `ranker` is the games-played counter, and Basketball Reference already
    // carries it forward across missed games — a DNP row repeats the previous
    // value rather than blanking. It is a `th`, not a `td`, so the selector
    // must not restrict the element type.
    const ranker = row.find("[data-stat='ranker']").first().text().trim();
    if (ranker !== "") lastGamesPlayed = Number(ranker);

    const teamGame = row
      .find("td[data-stat='team_game_num_season']")
      .first()
      .text()
      .trim();

    // Whether he actually appeared. `ranker` cannot answer this, since it is
    // populated either way; the career game number is blank precisely when the
    // player did not play. Missed games also carry class="partial_table" and
    // have no `pts` cell at all.
    const careerGameNum = row
      .find("td[data-stat='player_game_num_career']")
      .first()
      .text()
      .trim();

    // "W, 106-103" or "L, 98-112".
    const result = row.find("td[data-stat='game_result']").first().text().trim();
    const teamWon = result.startsWith("W")
      ? true
      : result.startsWith("L")
        ? false
        : null;

    entries.push({
      date,
      gamesPlayedToDate: lastGamesPlayed,
      teamGamesToDate: Number(teamGame) || 0,
      played: careerGameNum !== "",
      teamWon,
    });
  });

  return entries;
}

/** Fetch a game-log page. Separated from parsing so the parser stays testable. */
export async function fetchGameLogHtml(
  profileUrl: string,
  season: string | number,
): Promise<string> {
  const url = gameLogUrl(profileUrl, season);
  const res = await fetch(url, {
    headers: {
      // Basketball Reference rejects requests with no user agent.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (res.status === 429) {
    throw new Error(`Rate limited by basketball-reference on ${url}`);
  }
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  return res.text();
}

export async function fetchPlayerGameLog(data: {
  profileUrl: string;
  playerName: string;
  season: string | number;
}): Promise<GameLogEntry[]> {
  const entries = parseGameLog(
    await fetchGameLogHtml(data.profileUrl, data.season),
  );

  if (entries.length === 0) {
    logger.warn(`No regular-season game log found for ${data.playerName}`);
  }
  return entries;
}

/**
 * Games appeared in as of an ISO date. Entries must be ascending by date.
 *
 * Reads the running total at the most recent logged game on or before the
 * cutoff — not a count of entries, for the DNP reason in the header.
 */
export function gamesPlayedAsOf(entries: GameLogEntry[], isoDate: string): number {
  let result = 0;
  for (const entry of entries) {
    if (entry.date > isoDate) break;
    result = entry.gamesPlayedToDate;
  }
  return result;
}

/**
 * Games appeared in by the time the team had played `teamGames` games.
 *
 * Prefer this over gamesPlayedAsOf when a stored row already carries the team's
 * game count, because it removes the scrape-timing problem entirely.
 *
 * A date is ambiguous: the scraper reads the team page at a fixed hour, so a
 * row dated 11-26 can record 17 team games while the team in fact played its
 * 18th that same evening. Walking the log by date then counts a game the stored
 * row does not know about, and availability comes out above 1 — which happened
 * on 137 rows before this existed. The team's game number is the same clock on
 * both sides, so aligning on it cannot drift.
 */
export function gamesPlayedAtTeamGame(
  entries: GameLogEntry[],
  teamGames: number,
): number {
  let result = 0;
  for (const entry of entries) {
    if (entry.teamGamesToDate > teamGames) break;
    result = entry.gamesPlayedToDate;
  }
  return result;
}

/**
 * The team's record as of a date, derived from a player's log.
 *
 * The log carries every game the team played, won or lost, whether or not the
 * player appeared — so it is a complete record of the season from a source
 * independent of the team page. Used to repair rows where the team scrape
 * failed and stored a null record.
 */
export function teamRecordAsOf(
  entries: GameLogEntry[],
  isoDate: string,
): { wins: number; gamesPlayed: number } {
  let wins = 0;
  let gamesPlayed = 0;
  for (const entry of entries) {
    if (entry.date > isoDate) break;
    gamesPlayed = entry.teamGamesToDate || gamesPlayed + 1;
    if (entry.teamWon) wins++;
  }
  return { wins, gamesPlayed };
}
