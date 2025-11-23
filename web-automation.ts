import { saveDailyMvpRankingToMongo } from "./services/database/insert-data-into-database";
import { scrapeDailyStatsLeaders } from "./services/scraper/scrape-daily-stats-leaders";
import { calculateAllPlayerValues } from "./services/mvp-calculation/calculate-player-value";
import { scrapeMvpRankingsFromWebsite } from "./services/scraper/scrape-mvp-rankings-from-website";
import { chromium } from "playwright";
import { scrapePpgLeaders } from "./services/scraper/scrape-points-per-game-leaders";
import { fetchAllPlayerStats } from "./services/scraper/scrape-full-player-stats";

export async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const pointsPerGameLeaders = await scrapePpgLeaders({ page });
  const playerArray = [];
  console.log("grabbing all values for players");
  for (const player of pointsPerGameLeaders) {
    const result = await fetchAllPlayerStats({
      page,
      playerUrl: player.profileUrl,
      playerName: player.player,
    });

    playerArray.push(result);
  }
  console.log("Ranking Players");
  const rankedPlayers = calculateAllPlayerValues(playerArray);
  console.log("Saving rankings to mongo db atlas");
  await saveDailyMvpRankingToMongo(rankedPlayers);
}
