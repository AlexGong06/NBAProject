// Per-player game logs, used to recover how many games a player had actually
// appeared in on any given date.
//
// The daily pipeline does not need this: the per-game row on a player's page is
// cumulative, so a scrape on any day already reports that day's games played.
// This exists for history — rows collected before `gamesPlayed` was captured
// have no other way to recover it, and season-final totals cannot be applied
// backwards without claiming things about days that had not happened yet.
//
// Two traps, both verified against live markup:
//
//   1. The page carries TWO tables — `player_game_log_reg` and
//      `player_game_log_post`. The `ranker` column restarts at 1 for the
//      playoffs, so querying the document unscoped merges them and produces
//      nonsense. Always scope to the regular-season table.
//
//   2. Counting rows is NOT games played. The log lists every team game,
//      including ones the player missed: Jokić has 82 rows and 65 games played
//      for 2026. The `ranker` column increments only on games he appeared in
//      and repeats its previous value on DNP rows, so its running maximum is
//      the real figure.

import { Page } from "playwright";
import logger from "../../utils/logger";
import { wait } from "../../utils/wait";

export type GameLogEntry = {
  /** ISO date, "YYYY-MM-DD" — sortable as a string, unlike our M-D-YYYY keys. */
  date: string;
  /** Games the player had appeared in, counting this date. */
  gamesPlayedToDate: number;
  /** Team games played counting this date, from the season game number. */
  teamGamesToDate: number;
};

/** Turn a profile URL into its game-log URL for a season. */
export function gameLogUrl(profileUrl: string, season: string | number): string {
  // https://www.basketball-reference.com/players/j/jokicni01.html
  //   -> https://www.basketball-reference.com/players/j/jokicni01/gamelog/2026/
  const withoutExt = profileUrl.replace(/\.html?$/i, "");
  return `${withoutExt}/gamelog/${season}/`;
}

export async function fetchPlayerGameLog(data: {
  page: Page;
  profileUrl: string;
  playerName: string;
  season: string | number;
}): Promise<GameLogEntry[]> {
  const url = gameLogUrl(data.profileUrl, data.season);
  await data.page.goto(url, { waitUntil: "domcontentloaded" });
  await wait(1500);

  const entries = await data.page.evaluate(() => {
    const table = document.querySelector("#player_game_log_reg");
    if (!table) return null;

    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((tr) =>
      tr.querySelector("td[data-stat='date']"),
    );

    let lastGamesPlayed = 0;
    return rows.map((tr) => {
      const date =
        tr.querySelector("td[data-stat='date']")?.textContent?.trim() ?? "";

      // `ranker` is blank on rows the player missed, so carry the last value
      // forward rather than treating the gap as a reset.
      const rankerText =
        tr
          .querySelector("th[data-stat='ranker'], td[data-stat='ranker']")
          ?.textContent?.trim() ?? "";
      if (rankerText !== "") lastGamesPlayed = Number(rankerText);

      const teamGameText =
        tr
          .querySelector("td[data-stat='team_game_num_season']")
          ?.textContent?.trim() ?? "";

      return {
        date,
        gamesPlayedToDate: lastGamesPlayed,
        teamGamesToDate: Number(teamGameText) || 0,
      };
    });
  });

  if (!entries || entries.length === 0) {
    logger.warn(`No regular-season game log found for ${data.playerName}`);
    return [];
  }

  return entries.filter((e) => e.date !== "");
}

/**
 * Games appeared in as of an ISO date. Entries must be ascending by date.
 *
 * Returns the running total at the most recent logged game on or before the
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
