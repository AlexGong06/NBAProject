import { MongoClient } from "mongodb";
import { FullPlayerSummary } from "../../utils/types";
import dotenv from "dotenv";
import logger from "../../utils/logger";
import { toDateKey } from "../../utils/date-key";

export async function saveDailyMvpRankingToMongo(data: FullPlayerSummary[]) {
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

    const fullDate = toDateKey(new Date());

    for (const player of data) {
      const document = {
        date: fullDate,
        ...player,
      };

      try {
        await collection.insertOne(document);
        logger.info(`📊 Inserted ${player.player} MVP row for ${fullDate}`);
      } catch (err) {
        logger.error(`❌ Error inserting ${player.player}:` + err);
      }
    }
  } catch (err) {
    logger.error("🚨 Error connecting to MongoDB:" + err);
  } finally {
    await client.close();
    logger.info("🔒 MongoDB connection closed");
  }
}
