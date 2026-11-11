// Tags the rows that predate the `season` field.
//
//   pnpm backfill-season            dry run — reports what it would tag
//   pnpm backfill-season --apply    writes the field and ensures the indexes
//
// `PlayerDailyValues` holds every season in one collection, and every
// date-scoped query now filters on `season`. The 83,054 rows written before the
// field existed match none of those filters, so until this runs they are not
// wrong — they are invisible. `pnpm build-season --apply` refuses to write a
// second season while any of them remain, for exactly that reason.
//
// ── A row's season is looked up, not inferred ───────────────────────────────
//
// It would be easy to derive the season from the date — October onward belongs
// to the season starting that year — and that rule is correct for every season
// the NBA has played. It is still a rule being applied to data that can simply
// be asked. Each season's raw game logs record precisely which dates it was
// played on, so this joins against them, and refuses to guess for any date that
// no season claims.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";
import { SEASONS, seasonCollections } from "../src/utils/season";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const DAILY_COLLECTION = "PlayerDailyValues";

/**
 * Indexes made redundant by the `season` field.
 *
 * An index whose first field is not the one a query filters on cannot serve
 * that query, so these four answer nothing the API now asks. They are reported
 * rather than dropped: dropping an index is instant and rebuilding one on
 * 83,054 rows is not, so it is a decision to take deliberately and not a side
 * effect of a backfill.
 */
const SUPERSEDED_INDEXES = [
  "date_1_mvpValue_-1",
  "isoDate_1_mvpValue_-1",
  "player_1_isoDate_1",
  "series_covering",
];

function reportSupersededIndexes(indexes: { name?: string }[]): void {
  const present = indexes.map((i) => i.name);
  const stale = SUPERSEDED_INDEXES.filter((name) => present.includes(name));
  if (stale.length > 0) {
    console.log(
      `\n  These indexes no longer serve any query — they do not lead with\n` +
        `  \`season\`, so the API cannot use them. Drop them when you are\n` +
        `  satisfied the new ones are being used:\n`,
    );
    for (const name of stale) {
      console.log(`    db.${DAILY_COLLECTION}.dropIndex("${name}")`);
    }
  }
  console.log("");
}

/**
 * The four indexes every season-scoped query needs.
 *
 * Tagging the rows is only half of it. Until an index leads with `season`,
 * `distinct("isoDate", { season })` is a collection scan and the sorts the
 * board depends on fall back to sorting in memory — which is what returns
 * QueryExceededMemoryLimitNoDiskUseAllowed at 83,054 rows.
 *
 * `build-season --apply` ensures these too, so this is a duplicate on purpose:
 * a backfill that left the collection unqueryable until the next full build
 * would be a backfill that broke the app. `createIndex` is idempotent, and
 * these are the same four definitions as in scripts/build-season.ts.
 */
async function ensureIndexes(daily: any): Promise<void> {
  for (const [spec, options] of [
    [{ season: 1, date: 1, mvpValue: -1 }, {}],
    [{ season: 1, isoDate: 1, mvpValue: -1 }, {}],
    [{ season: 1, player: 1, isoDate: 1 }, {}],
    [
      { season: 1, isoDate: 1, mvpValue: -1, player: 1 },
      { name: "season_series_covering" },
    ],
  ] as const) {
    const name = await daily.createIndex(spec as any, options as any);
    logger.info(`index ensured: ${name}`);
  }
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("NbaDb");

  try {
    const daily = db.collection(DAILY_COLLECTION);

    const total = await daily.countDocuments({});
    const untaggedDates: string[] = await daily.distinct("isoDate", {
      season: { $exists: false },
    });

    if (untaggedDates.length === 0) {
      console.log(`\n  ${DAILY_COLLECTION} — ${total} rows, all tagged.`);
      // Still ensure the indexes. A re-run takes this path, and the first run
      // of this script shipped without them — so "nothing to tag" must not
      // mean "nothing to check", or the collection stays unindexed until the
      // next full build.
      if (APPLY) {
        await ensureIndexes(daily);
        reportSupersededIndexes(await daily.indexes());
      } else {
        console.log("\n  DRY RUN — indexes not touched. Re-run with --apply.\n");
      }
      return;
    }
    untaggedDates.sort();

    // Which season each untagged date belongs to, read off that season's own
    // game logs. A date claimed by two seasons would be a real contradiction
    // and is reported rather than resolved by whichever list came first.
    const seasonOf = new Map<string, string>();
    const contested: string[] = [];

    for (const season of SEASONS) {
      const { logs } = seasonCollections(season);
      const exists = await db.listCollections({ name: logs }).hasNext();
      if (!exists) {
        logger.info(`${logs} does not exist — skipping ${season}`);
        continue;
      }
      const dates: string[] = await db.collection(logs).distinct("date");
      for (const date of dates) {
        const already = seasonOf.get(date);
        if (already && already !== season) contested.push(`${date}: ${already} and ${season}`);
        else seasonOf.set(date, season);
      }
    }

    if (contested.length > 0) {
      throw new Error(
        `Dates claimed by more than one season:\n  ${contested.join("\n  ")}`,
      );
    }

    const bySeason = new Map<string, string[]>();
    const orphans: string[] = [];
    for (const date of untaggedDates) {
      const season = seasonOf.get(date);
      if (!season) orphans.push(date);
      else bySeason.set(season, [...(bySeason.get(season) ?? []), date]);
    }

    // ── Report ───────────────────────────────────────────────────────────────
    console.log(`\n  ${DAILY_COLLECTION}`);
    console.log(`    rows              ${total}`);
    console.log(`    untagged dates    ${untaggedDates.length}  (${untaggedDates[0]} → ${untaggedDates[untaggedDates.length - 1]})`);

    for (const [season, dates] of bySeason) {
      const rows = await daily.countDocuments({
        season: { $exists: false },
        isoDate: { $in: dates },
      });
      console.log(`    → ${season}          ${rows} rows across ${dates.length} dates`);
    }

    if (orphans.length > 0) {
      throw new Error(
        `${orphans.length} dates belong to no season's game logs, so their ` +
          `rows cannot be tagged. Refusing to write a partial backfill — a ` +
          `half-tagged collection serves a half season.\n  ` +
          `First: ${orphans.slice(0, 10).join(", ")}${orphans.length > 10 ? " …" : ""}`,
      );
    }

    if (!APPLY) {
      console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
      return;
    }

    // ── Write ────────────────────────────────────────────────────────────────
    //
    // One updateMany per season: a field added in place, which Mongo does
    // without moving the document. Re-running is harmless — the filter only
    // ever matches rows that still lack the field.
    for (const [season, dates] of bySeason) {
      const result = await daily.updateMany(
        { season: { $exists: false }, isoDate: { $in: dates } },
        { $set: { season } },
      );
      logger.info(`${season}: ${result.modifiedCount} rows tagged`);
    }

    const remaining = await daily.countDocuments({ season: { $exists: false } });
    if (remaining > 0) {
      throw new Error(`${remaining} rows are still untagged after the backfill.`);
    }

    console.log(`\n  All ${total} rows tagged.`);

    await ensureIndexes(daily);

    reportSupersededIndexes(await daily.indexes());
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
