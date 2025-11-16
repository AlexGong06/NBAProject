import { wait } from "./services/utils/wait";
import { saveToMongo } from "./services/database/insert-data-into-database";
import { scrapeDailyStatsLeaders } from "./services/scraper/scrape-daily-stats-leaders";
import { calculateAllPlayerValues } from "./services/mvp-calculation/calculate-player-value";
import { scrapeMvpRankingsFromWebsite } from "./services/scraper/scrape-mvp-rankings-from-website";

export async function main() {
  //const data = await scrapeDailyStatsLeaders()
  const data = await scrapeMvpRankingsFromWebsite();
  //const players = calculateAllPlayerValues(data)
  //console.dir(players, { depth: null });
  //await saveToMongo(data);
}
