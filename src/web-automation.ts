import { saveDailyMvpRankingToMongo } from "./services/database/insert-data-into-database";
import { calculateAllPlayerValues } from "./services/mvp-calculation/calculate-player-value";
import { chromium } from "playwright";
import { scrapePpgLeaders } from "./services/scraper/scrape-points-per-game-leaders";
import { fetchAllPlayerStats } from "./services/scraper/scrape-full-player-stats";
import logger from "./utils/logger";

export async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pointsPerGameLeaders = await scrapePpgLeaders({ page });
  const playerArray = [];
  logger.info("grabbing all values for players");
  for (const player of pointsPerGameLeaders) {
    const result = await fetchAllPlayerStats({
      page,
      playerUrl: player.profileUrl,
      playerName: player.player,
    });

    playerArray.push(result);
  }
  logger.info("Ranking Players");
  const rankedPlayers = calculateAllPlayerValues(playerArray);
  logger.info("Saving rankings to mongo db atlas");
  await saveDailyMvpRankingToMongo(rankedPlayers);
}
