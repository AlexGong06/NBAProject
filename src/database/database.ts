import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGO_URI;

if (!uri) {
  throw new Error("Missing MONGO_URI environment variable");
}

const client = new MongoClient(uri);

let cachedDb: any = null;

export async function getDb() {
  if (!cachedDb) {
    await client.connect();
    cachedDb = client.db("NbaDb");
  }
  return cachedDb;
}
