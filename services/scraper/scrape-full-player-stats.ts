import { Page } from "playwright";
import { wait } from "../../utils/wait";
import { FullPlayerSummary, FullPlayerSummarySchema } from "../../utils/types";
import dotenv from "dotenv";
import logger from "../../utils/logger";

export async function fetchAllPlayerStats(data: {
  page: Page;
  playerUrl: string;
  playerName: string;
}): Promise<FullPlayerSummary> {
  dotenv.config();
  // Navigate to the player profile page
  await data.page.goto(data.playerUrl, { waitUntil: "domcontentloaded" });

  // Basketball Reference always exposes advanced stats inside #all_advanced
  // but the target row is simply identified by the ID pattern i.e "advanced.YYYY"

  const season = process.env.NBA_SEASON; // replace with dynamic season if needed
  const advancedRowId = `advanced.${season}`;
  const perGameRowId = `per_game_stats.${season}`;

  // Per Game Stats scraping
  const perGameStats = await data.page.evaluate((rowId) => {
    const row = document.querySelector(`tr#${CSS.escape(rowId)}`);
    if (!row) return null; // Player may not have advanced stats for season

    const getPerGameStat = (stat: string) => {
      const cell = row.querySelector(`td[data-stat='${stat}']`);
      if (!cell) return null;
      const raw = cell.textContent?.trim() || "";
      return raw === "" ? null : parseFloat(raw.replace("%", ""));
    };

    const getTeam = (team: string) => {
      const cell = row.querySelector(`td[data-stat='${team}']`);
      if (!cell) return null;
      const raw = cell.textContent?.trim() || "";
      return raw === "" ? null : raw.replace("%", "");
    };

    return {
      minutesPerGame: getPerGameStat("mp_per_g"),
      pointsPerGame: getPerGameStat("pts_per_g"),
      assistsPerGame: getPerGameStat("ast_per_g"),
      reboundsPerGame: getPerGameStat("trb_per_g"),
      blocksPerGame: getPerGameStat("blk_per_g"),
      stealsPerGame: getPerGameStat("stl_per_g"),
      foulsPerGame: getPerGameStat("pf_per_g"),
      turnoversPerGame: getPerGameStat("tov_per_g"),
      gamesStarted: getPerGameStat("games_started"),
      team: getTeam("team_name_abbr"),
    };
  }, perGameRowId);

  // Advanced Stats scraping
  const advancedStats = await data.page.evaluate((rowId) => {
    const row = document.querySelector(`tr#${CSS.escape(rowId)}`);
    if (!row) return null; // Player may not have advanced stats for season

    const getAdvancedStat = (stat: string) => {
      const cell = row.querySelector(`td[data-stat='${stat}']`);
      if (!cell) return null;
      const raw = cell.textContent?.trim() || "";
      return raw === "" ? null : parseFloat(raw.replace("%", ""));
    };

    return {
      trueShootingPercentage: getAdvancedStat("ts_pct"), // .773
      usageRate: getAdvancedStat("usg_pct"), // 27.0
      winShare: getAdvancedStat("ws"), // 3.6
      boxPlusMinus: getAdvancedStat("bpm"), // 20.8
      valueOverReplacement: getAdvancedStat("vorp"), // 2.2
    };
  }, advancedRowId);

  if (!advancedStats || !perGameStats) {
    logger.warn(
      `Could not find advanced/per game stats row for ${data.playerName}`
    );
  }
  logger.info(
    `navigating to team page to scrape team wins: ${perGameStats.team}`
  );
  await data.page.goto(
    `https://www.basketball-reference.com/teams/${perGameStats.team}/${season}.html`,
    { waitUntil: "domcontentloaded" }
  );
  await wait(2000);

  // Team Stats scraping
  const teamStats = await data.page.evaluate(() => {
    const getTeamStat = (stat: string) => {
      const cell = document.querySelector(`td[data-stat='${stat}']`);
      if (!cell) return null;
      const raw = cell.textContent?.trim() || "";
      return raw === "" ? null : parseFloat(raw.replace("%", ""));
    };
    const teamWins = getTeamStat("wins");
    const teamLoses = getTeamStat("losses");
    return {
      teamWins,
      teamGamesPlayed: teamLoses + teamWins,
    };
  });
  // Return Full Player object with all necessary statistics to calculate MVP value

  // ------------------------------------
  // Combine Raw Output
  // ------------------------------------
  const rawObject = {
    player: data.playerName,
    profileUrl: data.playerUrl,
    ...teamStats,
    ...perGameStats,
    ...advancedStats,
  };

  // ------------------------------------
  // Zod Validation
  // ------------------------------------
  const result = FullPlayerSummarySchema.safeParse(rawObject);

  if (!result.success) {
    logger.error(`Validation failed for player ${data.playerName}:`);
    logger.error(result.error.format());
    throw new Error(
      `FullPlayerSummary validation failed for ${data.playerName}`
    );
  }

  return result.data;
}
