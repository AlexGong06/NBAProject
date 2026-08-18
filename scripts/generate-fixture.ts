// Exports the front end's offline fixture from PlayerDailyValues.
//
//   pnpm generate-fixture
//
// Writes src/front-end/public/rankings.json, which the front end fetches in
// fixture mode. Committed, so a fresh clone runs the whole app with no database
// and no network — and what it shows is real data.
//
// This computes nothing. Every term of the formula is stored, so exporting is a
// straight copy. If a number here disagrees with the API, the export is wrong,
// not the formula.
//
// ── What gets exported ─────────────────────────────────────────────────────
//
// The whole season, top N players per date. The season arc is the product —
// watching a race turn over 164 days — so truncating to a recent window would
// throw away the thing worth showing. Depth is what gets traded instead: the
// database holds all 582 players per date, and 582 × 164 would be a 40 MB file
// committed to git.
//
// No rank is exported, because none is stored. `buildDataSource` sorts by score
// and numbers the result on read, exactly as it does with the live API.
//
// A development tool. Never run by the app.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import logger from "../src/utils/logger";

dotenv.config();

const COLLECTION = "PlayerDailyValues";
const TOP_PER_DATE = 25;
const PUBLIC_DIR = join(__dirname, "..", "src", "front-end", "public");
const OUT = join(PUBLIC_DIR, "rankings.json");

/**
 * Exactly the fields the front end reads.
 *
 * `_id`, `playerId`, `teamId`, `isoDate` and the possession totals stay in the
 * database — they are ingestion and query concerns, and every byte here is
 * committed to the repository.
 */
const PROJECTION = {
  _id: 0,
  date: 1, player: 1, team: 1, pos: 1, age: 1, profileUrl: 1,
  teamWins: 1, teamLosses: 1, teamGamesPlayed: 1, gamesPlayed: 1,
  minutesPerGame: 1, pointsPerGame: 1, assistsPerGame: 1, reboundsPerGame: 1,
  blocksPerGame: 1, stealsPerGame: 1, foulsPerGame: 1, turnoversPerGame: 1,
  usageRate: 1, pie: 1, netRating: 1, trueShootingPercentage: 1,
  teamWinRatio: 1, availability: 1, minutesFactor: 1, usageFactor: 1,
  levelOfImpact: 1, qualityOfImpact: 1, winContribution: 1, totalStats: 1,
  rawValue: 1, mvpValue: 1, formulaVersion: 1,
} as const;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("NbaDb").collection(COLLECTION);

  try {
    const dates: string[] = await col.distinct("isoDate");
    if (dates.length === 0) {
      throw new Error(`${COLLECTION} is empty. Run \`pnpm build-season --apply\` first.`);
    }
    dates.sort(); // ISO, so lexicographic is chronological

    // One indexed query per date. An aggregation over the whole collection
    // exceeds Mongo's 100 MB in-memory limit — see the API route for the same
    // finding.
    const perDate = await Promise.all(
      dates.map((isoDate) =>
        col
          .find({ isoDate }, { projection: PROJECTION })
          .sort({ mvpValue: -1 })
          .limit(TOP_PER_DATE)
          .toArray(),
      ),
    );

    const rows = perDate.flat();

    // The front end throws if a breakdown term is missing rather than rendering
    // blanks, so catch it here where the fix is obvious.
    const required = ["mvpValue", "availability", "winContribution", "totalStats", "pie", "netRating"];
    const bad = rows.find((r) => required.some((k) => typeof r[k] !== "number"));
    if (bad) {
      throw new Error(`Row is missing a required term: ${JSON.stringify(bad).slice(0, 200)}`);
    }

    // Round every number to 6 decimals before writing.
    //
    // Mongo returns full double precision, so a stored 0.7901234567901234 costs
    // 18 bytes to express a value the UI renders as "0.790". Across 4,100 rows
    // of 33 fields that float noise is most of the file — 3.7 MB before, 1.4
    // after. Six decimals is far finer than anything displayed and finer than
    // the 1e-9 tolerance the invariant checks use, so nothing observable moves.
    const rounded = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] = typeof value === "number" ? Number(value.toFixed(6)) : value;
      }
      return out;
    });

    mkdirSync(PUBLIC_DIR, { recursive: true });
    writeFileSync(OUT, JSON.stringify(rounded));

    const mb = (statSync(OUT).size / 1024 / 1024).toFixed(1);
    logger.info(
      `wrote ${rows.length} rows (${dates.length} dates × top ${TOP_PER_DATE}) to ${OUT} — ${mb} MB`,
    );
    console.log(`\n  ${dates[0]} → ${dates[dates.length - 1]}`);
    console.log(`  leader on the final date: ${perDate[perDate.length - 1][0].player}\n`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
