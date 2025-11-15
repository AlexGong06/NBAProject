import { wait } from "./wait";
import { saveToMongo } from "./insert-data-into-database";
import { scrapeDailyStatsLeaders } from "./scrape-daily-stats-leaders";
import { scrapePlayerStatistics } from "./scrape-player-statistics";
import { calculateAllPlayerValues } from "./calculate-player-value";


export async function main() {

  //const data = await scrapeDailyStatsLeaders()
  const data = await scrapePlayerStatistics();
  const players = calculateAllPlayerValues(data)
  console.dir(players, { depth: null });
  //await saveToMongo(data);
}
