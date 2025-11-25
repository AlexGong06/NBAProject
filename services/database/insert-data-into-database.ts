import { MongoClient } from "mongodb";
import { FullPlayerSummary } from "../utils/types";
import dotenv from "dotenv";

export async function saveDailyMvpRankingToMongo(data: FullPlayerSummary[]) {
  dotenv.config();

  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("Missing MONGO_URI environment variable");
  }
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("NbaDb");
    const collection = db.collection("DailyMvpRankings");

    const date = new Date();
    const fullDate = `${
      date.getMonth() + 1
    }-${date.getDate()}-${date.getFullYear()}`;

    for (const player of data) {
      const document = {
        date: fullDate,
        ...player,
      };

      try {
        await collection.insertOne(document);
        console.log(`📊 Inserted ${player.player} MVP row for ${fullDate}`);
      } catch (err) {
        console.error(`❌ Error inserting ${player.player}:`, err);
      }
    }
  } catch (err) {
    console.error("🚨 Error connecting to MongoDB:", err);
  } finally {
    await client.close();
    console.log("🔒 MongoDB connection closed");
  }
}
