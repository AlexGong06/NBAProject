// Retires the Basketball Reference era collections.
//
//   pnpm cleanup            dry run — verifies and reports, deletes nothing
//   pnpm cleanup --apply    backs up to backups/, then drops
//
// `DailyMvpRankings` (2,561 rows, 28 players, formula v2) and
// `DailyStatsLeaders` (94 rows, one date, written by a scraper the pipeline
// never called) are superseded by `PlayerDailyValues` — 83,054 rows, 582
// players, every regular-season date, formula v3.
//
// **The delete is gated on proving the replacement exists first.** The old rows
// hold VORP, win shares and BPM scraped mid-season, and Basketball Reference
// serves only current-season totals — so deleting them is irreversible in a way
// recomputing from the NBA API is not.
//
// Every old (player, date) must have a counterpart in PlayerDailyValues, or
// fall on a date with no regular-season games, where the old scraper simply
// restated the previous day. Any other gap aborts the run.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import logger from "../src/utils/logger";
import { compareDateKeys } from "../src/utils/date-key";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = join(__dirname, "..", "backups");

/** Collections to retire, and the collection that must replace them. */
const LEGACY = ["DailyMvpRankings", "DailyStatsLeaders"];
const REPLACEMENT = "PlayerDailyValues";

/** Below this, PlayerDailyValues has clearly not been built. */
const MIN_REPLACEMENT_ROWS = 50_000;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("NbaDb");

  try {
    // ── Gate 1: the replacement must exist and be plausibly complete ───────
    const replacementCount = await db.collection(REPLACEMENT).countDocuments();
    if (replacementCount < MIN_REPLACEMENT_ROWS) {
      throw new Error(
        `${REPLACEMENT} has only ${replacementCount} rows (expected ≥ ${MIN_REPLACEMENT_ROWS}). ` +
          `Run \`pnpm build-season --apply\` first. Nothing deleted.`,
      );
    }

    const newRows = await db
      .collection(REPLACEMENT)
      .find({}, { projection: { player: 1, date: 1 } })
      .toArray();
    const covered = new Set(newRows.map((r) => `${r.player}|${r.date}`));
    const newDates = new Set(newRows.map((r) => r.date));

    console.log(`\n  ${REPLACEMENT}   ${replacementCount} rows, ${newDates.size} dates`);

    // ── Gate 2: every old row must be superseded, or on a no-game date ─────
    const oldRows = await db
      .collection("DailyMvpRankings")
      .find({}, { projection: { player: 1, date: 1 } })
      .toArray();

    const unsuperseded = oldRows.filter((r) => !covered.has(`${r.player}|${r.date}`));
    const orphanDates = [...new Set(unsuperseded.map((r) => r.date))].sort(compareDateKeys);

    // A date the new pipeline never produced is a date the NBA played no
    // regular-season games. A row on such a date is a carry-forward.
    const carryForward = unsuperseded.filter((r) => !newDates.has(r.date));
    const genuinelyMissing = unsuperseded.filter((r) => newDates.has(r.date));

    console.log(`  DailyMvpRankings   ${oldRows.length} rows`);
    console.log(`    superseded row-for-row      ${oldRows.length - unsuperseded.length}`);
    console.log(`    on dates with no NBA games  ${carryForward.length}  (${orphanDates.join(", ")})`);
    console.log(`    unexplained                 ${genuinelyMissing.length}`);

    if (genuinelyMissing.length > 0) {
      const sample = genuinelyMissing.slice(0, 10).map((r) => `${r.date} ${r.player}`);
      throw new Error(
        `${genuinelyMissing.length} old rows sit on dates the new data covers but have no ` +
          `counterpart:\n  ${sample.join("\n  ")}\n` +
          `That is real data loss, not a carry-forward. Nothing deleted.`,
      );
    }

    for (const name of LEGACY) {
      const n = await db.collection(name).countDocuments();
      console.log(`  would drop   ${name.padEnd(20)} ${n} rows`);
    }

    if (!APPLY) {
      console.log("\n  DRY RUN — nothing deleted. Re-run with --apply.\n");
      return;
    }

    // ── Back up, verify the backup, then drop ─────────────────────────────
    //
    // Read the file back before dropping. A backup that was never actually
    // written is worse than no backup, because it is why you felt safe.
    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    for (const name of LEGACY) {
      const docs = await db.collection(name).find({}).toArray();
      if (docs.length === 0) {
        logger.info(`${name} is already empty — skipping`);
        continue;
      }

      const path = join(BACKUP_DIR, `${name}-${stamp}.json`);
      writeFileSync(path, JSON.stringify(docs, null, 2));

      const readBack = JSON.parse(readFileSync(path, "utf8"));
      if (!Array.isArray(readBack) || readBack.length !== docs.length) {
        throw new Error(
          `Backup of ${name} did not verify (${readBack?.length} vs ${docs.length}). Nothing dropped.`,
        );
      }
      logger.info(`backed up ${docs.length} rows to ${path}`);

      await db.collection(name).drop();
      logger.info(`dropped ${name}`);
    }

    console.log("\n  Done. Backups are in backups/ — they are the only copy.\n");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
