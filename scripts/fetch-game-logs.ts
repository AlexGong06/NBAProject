// Fetches a game log for every player in the rankings collection.
//
//   pnpm fetch-game-logs
//
// Writes .cache/game-logs.json (gitignored, rebuildable). The migration reads
// that file and never touches the network, which matters for three reasons:
// the migration gets run repeatedly while its report is being read, a failure
// partway through should not mean re-fetching everything, and a job that
// rewrites 2,561 rows should not depend on 28 HTTP requests all succeeding.
//
// Safe to re-run: players already cached are skipped unless --refresh is
// passed, so an interrupted run resumes where it stopped.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import logger from "../src/utils/logger";
import { parseDateKey } from "../src/utils/date-key";
import {
  POLITE_DELAY_MS,
  fetchPlayerGameLog,
  gamesPlayedAsOf,
  type GameLogEntry,
} from "../src/services/scraper/scrape-player-game-log";

dotenv.config();

const CACHE_DIR = join(__dirname, "..", ".cache");
const CACHE_FILE = join(CACHE_DIR, "game-logs.json");
const REFRESH = process.argv.includes("--refresh");

type Cache = {
  season: string;
  fetchedAt: string;
  players: Record<string, { profileUrl: string; entries: GameLogEntry[] }>;
};

function isoOf(dateKey: string): string {
  const d = parseDateKey(dateKey);
  if (!d) throw new Error(`Unparseable date key: ${dateKey}`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");
  const season = process.env.NBA_SEASON ?? "2026";

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("NbaDb").collection("DailyMvpRankings");

  // One profile URL per player. Taking it from the stored rows rather than
  // reconstructing Basketball Reference ids by hand keeps the join exact.
  const players = new Map<string, string>();
  for (const r of await col
    .find({}, { projection: { player: 1, profileUrl: 1, _id: 0 } })
    .toArray()) {
    if (!players.has(r.player)) players.set(r.player, r.profileUrl);
  }
  logger.info(`${players.size} distinct players in the collection`);

  const cache: Cache =
    existsSync(CACHE_FILE) && !REFRESH
      ? JSON.parse(readFileSync(CACHE_FILE, "utf8"))
      : { season, fetchedAt: new Date().toISOString(), players: {} };

  if (cache.season !== season) {
    throw new Error(
      `Cache holds season ${cache.season} but NBA_SEASON is ${season}. ` +
        `Re-run with --refresh.`,
    );
  }

  const todo = [...players].filter(([name]) => !cache.players[name]);
  logger.info(
    `${Object.keys(cache.players).length} cached, ${todo.length} to fetch ` +
      `(~${Math.ceil((todo.length * POLITE_DELAY_MS) / 1000)}s)`,
  );

  for (const [name, profileUrl] of todo) {
    const entries = await fetchPlayerGameLog({ profileUrl, playerName: name, season });

    // Empty means the page shape changed or the player has no regular-season
    // row. Either way it must not be cached as an answer: downstream it would
    // read as zero games played, i.e. zero availability, and quietly bury the
    // player at the bottom of every board.
    if (entries.length === 0) {
      throw new Error(
        `No regular-season game log for ${name} (${profileUrl}). Refusing to ` +
          `cache an empty log — it would score as zero availability.`,
      );
    }

    cache.players[name] = { profileUrl, entries };
    const played = entries.filter((e) => e.played).length;
    logger.info(`  ${name}: ${entries.length} games listed, ${played} played`);

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  }

  cache.fetchedAt = new Date().toISOString();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n  PLAYER                     LISTED  PLAYED   DNP   FINAL");
  for (const [name, { entries }] of Object.entries(cache.players)) {
    const played = entries.filter((e) => e.played).length;
    const final = entries[entries.length - 1].gamesPlayedToDate;
    console.log(
      `  ${name.padEnd(26)} ${String(entries.length).padStart(4)}` +
        `${String(played).padStart(8)}${String(entries.length - played).padStart(6)}` +
        `${String(final).padStart(8)}`,
    );
  }

  // ── Validation against data we already hold ──────────────────────────────
  //
  // Every stored row carries gamesStarted, which the scraper read straight off
  // Basketball Reference on the day. A player cannot start more games than he
  // played, so gamesStarted <= derived gamesPlayed must hold on all 2,561 rows.
  // Nothing here is circular: the two numbers come from different pages,
  // scraped months apart.
  const rows = await col.find({}).toArray();
  const violations: string[] = [];
  let checked = 0;

  for (const r of rows) {
    const cached = cache.players[r.player];
    if (!cached) continue;
    const gamesPlayed = gamesPlayedAsOf(cached.entries, isoOf(r.date));
    checked++;
    if (r.gamesStarted > gamesPlayed) {
      violations.push(
        `${r.date} ${r.player}: started ${r.gamesStarted} but derived ${gamesPlayed} played`,
      );
    }
  }

  console.log(`\n  cross-check: gamesStarted <= gamesPlayed on ${checked} rows`);
  if (violations.length === 0) {
    console.log("  no violations");
  } else {
    console.log(`  ${violations.length} VIOLATIONS:`);
    violations.slice(0, 15).forEach((v) => console.log(`    ${v}`));
  }

  logger.info(`cache written to ${CACHE_FILE}`);
  await client.close();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
