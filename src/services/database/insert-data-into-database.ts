import { MongoClient } from "mongodb";
import { PlayerWithCalculatedMvpValue } from "../../utils/types";
import dotenv from "dotenv";
import logger from "../../utils/logger";
import { toDateKey } from "../../utils/date-key";

// The pipeline hands this the ranked rows, not raw summaries — the parameter
// was typed FullPlayerSummary[], which happens to compile because the ranked
// type extends it, but it understated what actually gets stored.
export async function saveDailyMvpRankingToMongo(
  data: PlayerWithCalculatedMvpValue[],
) {
  dotenv.config();

  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("Missing MONGO_URI environment variable");
  }
  const client = new MongoClient(uri);

  try {
    await client.connect();
    logger.info("✅ Connected to MongoDB");

    const db = client.db("NbaDb");
    const collection = db.collection("DailyMvpRankings");

    // One row per player per day. Without this, re-running the scraper on a day
    // it already covered stores every player twice, and the front end reads the
    // duplicates as extra candidates.
    await collection.createIndex({ date: 1, player: 1 }, { unique: true });

    const fullDate = toDateKey(new Date());

    // A day is all-or-nothing. Previously a failed write was logged and the
    // loop continued, so five of eight players could be stored and the API
    // would serve that partial day as a complete ranking with a 200 — worse
    // than a missing day, because nothing signals it. Collect first, fail loud.
    const failures: string[] = [];

    for (const player of data) {
      const document = {
        date: fullDate,
        ...player,
      };

      try {
        await collection.replaceOne(
          { date: fullDate, player: player.player },
          document,
          { upsert: true },
        );
        logger.info(`📊 Stored ${player.player} MVP row for ${fullDate}`);
      } catch (err) {
        logger.error(`❌ Error storing ${player.player}:` + err);
        failures.push(player.player);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Stored an incomplete ranking for ${fullDate}: ${failures.length} of ` +
          `${data.length} players failed (${failures.join(", ")}). The day is ` +
          `partial and should not be trusted.`,
      );
    }
  } catch (err) {
    logger.error("🚨 Error writing rankings to MongoDB:" + err);
    // Rethrow. Swallowing this meant a scrape that stored nothing exited zero,
    // so the scheduled GitHub Action reported success on a day it wrote no
    // rankings at all.
    throw err;
  } finally {
    await client.close();
    logger.info("🔒 MongoDB connection closed");
  }
}
