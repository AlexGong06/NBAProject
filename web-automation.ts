import { wait } from "./services/utils/wait";
import { saveToMongo } from "./services/database/insert-data-into-database";
import { scrapeDailyStatsLeaders } from "./services/scraper/scrape-daily-stats-leaders";
import { scrapePlayerStatistics } from "./services/scraper/scrape-player-statistics";
import { calculateAllPlayerValues } from "./services/mvp-calculation/calculate-player-value";


export async function main() {

  //const data = await scrapeDailyStatsLeaders()
  const data = await scrapePlayerStatistics();
  const players = calculateAllPlayerValues(data)
  console.dir(players, { depth: null });
  //await saveToMongo(data);
}
