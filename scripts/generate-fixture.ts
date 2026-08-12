// Exports the front end's offline fixture from the rankings collection.
//
//   pnpm generate-fixture
//
// Reads a window of real rows out of MongoDB and writes them to
// src/front-end/public/rankings.json, which the front end fetches in fixture
// mode. Committed, so a fresh clone runs with no database and no network — and
// what it shows is real data, including the days the collector genuinely
// missed.
//
// This computes nothing. It used to recover games played from game logs and
// re-run the formula, because the database only stored a final score; since the
// v2 migration every term is stored, so exporting is a straight copy. If a
// number here disagrees with the API, the export is wrong — not the formula.
//
// A development tool. Never run by the app or by CI.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import logger from "../src/utils/logger";
import { compareDateKeys, parseDateKey, toDateKey } from "../src/utils/date-key";

dotenv.config();

/** Calendar days back from the most recent scrape to include. */
const WINDOW_DAYS = 30;
const PUBLIC_DIR = join(__dirname, "..", "src", "front-end", "public");
const OUT = join(PUBLIC_DIR, "rankings.json");

/** Fields the front end reads. Everything else stays in the database. */
const PROJECTION = {
  _id: 0,
  date: 1, player: 1, team: 1, pos: 1, age: 1,
  teamWins: 1, teamLosses: 1, teamGamesPlayed: 1, gamesStarted: 1, gamesPlayed: 1,
  minutesPerGame: 1, pointsPerGame: 1, assistsPerGame: 1, reboundsPerGame: 1,
  blocksPerGame: 1, stealsPerGame: 1, foulsPerGame: 1, turnoversPerGame: 1,
  usageRate: 1, valueOverReplacement: 1, winShare: 1, boxPlusMinus: 1,
  trueShootingPercentage: 1,
  teamWinRatio: 1, availability: 1, minutesFactor: 1, usageFactor: 1,
  levelOfImpact: 1, qualityOfImpact: 1, winContribution: 1, totalStats: 1,
  rawValue: 1, mvpValue: 1, calculatedRank: 1, formulaVersion: 1,
} as const;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("NbaDb").collection("DailyMvpRankings");

  const allKeys: string[] = await col.distinct("date");
  const sorted = [...allKeys].sort(compareDateKeys);
  const lastKey = sorted[sorted.length - 1];
  const last = parseDateKey(lastKey);
  if (!last) throw new Error(`Unparseable latest date: ${lastKey}`);

  const firstDate = new Date(last);
  firstDate.setDate(firstDate.getDate() - (WINDOW_DAYS - 1));

  // Walk the calendar, not the stored dates, so days with no scrape are visible
  // as gaps rather than silently closing up.
  const calendar: string[] = [];
  for (let d = new Date(firstDate); d <= last; d.setDate(d.getDate() + 1)) {
    calendar.push(toDateKey(d));
  }
  const present = calendar.filter((k) => allKeys.includes(k));

  const rows = await col
    .find({ date: { $in: present } }, { projection: PROJECTION })
    .toArray();

  // The front end will refuse rows without a stored breakdown, so catch it here
  // where the message can name the fix rather than in a browser.
  const incomplete = rows.filter(
    (r) => typeof r.mvpValue !== "number" || typeof r.availability !== "number",
  );
  if (incomplete.length > 0) {
    throw new Error(
      `${incomplete.length} rows have no stored breakdown — run \`pnpm migrate --apply\` first.`,
    );
  }

  rows.sort(
    (a, b) =>
      compareDateKeys(b.date as string, a.date as string) ||
      (a.calculatedRank as number) - (b.calculatedRank as number),
  );

  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(rows));

  logger.info(`wrote ${rows.length} rows to ${OUT}`);
  logger.info(
    `window ${calendar[0]} -> ${lastKey}: ${present.length} scraped, ` +
      `${calendar.length - present.length} gaps, ` +
      `${new Set(rows.map((r) => r.player)).size} players`,
  );

  await client.close();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
