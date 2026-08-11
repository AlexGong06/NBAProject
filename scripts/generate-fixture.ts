// Generates the front end's offline fixture from real stored rankings.
//
//   pnpm generate-fixture
//
// Reads a window of real rows out of MongoDB, recovers each player's games
// played on each date from their Basketball Reference game log, recomputes the
// score under the current formula, and writes the result to
// src/front-end/public/rankings.json.
//
// The front end fetches that file in fixture mode. It is committed, so a fresh
// clone runs with no database and no network — and what it shows is real data
// rather than a simulation, including the days the collector genuinely missed.
//
// This script is a development tool. It is never run by the app or by CI.

import { MongoClient } from "mongodb";
import { chromium } from "playwright";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import logger from "../src/utils/logger";
import { scoreBreakdown } from "../src/shared/mvp-formula";
import { CURRENT_FORMULA_VERSION } from "../src/utils/types";
import { compareDateKeys, parseDateKey, toDateKey } from "../src/utils/date-key";
import {
  fetchPlayerGameLog,
  gamesPlayedAsOf,
  type GameLogEntry,
} from "../src/services/scraper/scrape-player-game-log";

dotenv.config();

/** How many calendar days back from the most recent scrape to include. */
const WINDOW_DAYS = 30;
const OUT = join(__dirname, "..", "src", "front-end", "public", "rankings.json");

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

  // ── Pick the window ──────────────────────────────────────────────────────
  const allKeys: string[] = await col.distinct("date");
  const sorted = [...allKeys].sort(compareDateKeys);
  const lastKey = sorted[sorted.length - 1];
  const last = parseDateKey(lastKey);
  if (!last) throw new Error(`Unparseable latest date: ${lastKey}`);

  const firstDate = new Date(last);
  firstDate.setDate(firstDate.getDate() - (WINDOW_DAYS - 1));

  // Every calendar day in the window, so days with no scrape stay visible as
  // gaps rather than disappearing from the timeline.
  const calendar: string[] = [];
  for (let d = new Date(firstDate); d <= last; d.setDate(d.getDate() + 1)) {
    calendar.push(toDateKey(d));
  }
  const windowKeys = calendar.filter((k) => allKeys.includes(k));

  logger.info(
    `window ${calendar[0]} -> ${lastKey}: ${windowKeys.length} scraped of ${calendar.length} days`,
  );

  const rows = await col.find({ date: { $in: windowKeys } }).toArray();
  logger.info(`loaded ${rows.length} rows`);

  // ── Recover games played from game logs ──────────────────────────────────
  const byPlayer = new Map<string, { profileUrl: string }>();
  for (const r of rows) {
    if (!byPlayer.has(r.player)) byPlayer.set(r.player, { profileUrl: r.profileUrl });
  }
  logger.info(`fetching game logs for ${byPlayer.size} players`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = new Map<string, GameLogEntry[]>();

  for (const [playerName, { profileUrl }] of byPlayer) {
    try {
      const entries = await fetchPlayerGameLog({ page, profileUrl, playerName, season });
      logs.set(playerName, entries);
      logger.info(`  ${playerName}: ${entries.length} logged games`);
    } catch (err) {
      logger.error(`  ${playerName}: game log failed — ${String(err)}`);
      logs.set(playerName, []);
    }
  }
  await browser.close();

  // ── Recompute under the current formula ──────────────────────────────────
  const missingGameLog: string[] = [];
  const out = rows.map((r) => {
    const entries = logs.get(r.player) ?? [];
    const gamesPlayed = gamesPlayedAsOf(entries, isoOf(r.date));

    // A player with no usable log would otherwise score zero and silently sink
    // to the bottom of the board. Record it and fail loudly below instead.
    if (entries.length === 0) missingGameLog.push(r.player);

    // Built field by field rather than spread from the Mongo document: the
    // driver types rows as opaque Documents, so a spread would hide a missing
    // field behind a cast and score it as zero.
    const base = {
      date: r.date as string,
      player: r.player as string,
      profileUrl: r.profileUrl as string,
      team: r.team as string,
      pos: (r.pos ?? null) as string | null,
      age: (r.age ?? null) as number | null,
      teamWins: r.teamWins as number,
      teamLosses: (r.teamLosses ?? r.teamGamesPlayed - r.teamWins) as number,
      teamGamesPlayed: r.teamGamesPlayed as number,
      gamesStarted: r.gamesStarted as number,
      gamesPlayed,
      minutesPerGame: r.minutesPerGame as number,
      pointsPerGame: r.pointsPerGame as number,
      assistsPerGame: r.assistsPerGame as number,
      reboundsPerGame: r.reboundsPerGame as number,
      blocksPerGame: r.blocksPerGame as number,
      stealsPerGame: r.stealsPerGame as number,
      foulsPerGame: r.foulsPerGame as number,
      turnoversPerGame: r.turnoversPerGame as number,
      usageRate: r.usageRate as number,
      valueOverReplacement: r.valueOverReplacement as number,
      winShare: r.winShare as number,
      boxPlusMinus: r.boxPlusMinus as number,
      trueShootingPercentage: r.trueShootingPercentage as number,
    };

    return {
      ...base,
      ...scoreBreakdown(base),
      formulaVersion: CURRENT_FORMULA_VERSION,
    };
  });

  if (missingGameLog.length > 0) {
    throw new Error(
      `No game log for ${[...new Set(missingGameLog)].join(", ")} — every player ` +
        `needs one, or their availability would silently be zero.`,
    );
  }

  // ── Rank within each date ────────────────────────────────────────────────
  const grouped = new Map<string, typeof out>();
  for (const row of out) {
    const list = grouped.get(row.date) ?? [];
    list.push(row);
    grouped.set(row.date, list);
  }
  const ranked = [...grouped.values()].flatMap((list) =>
    list
      .sort((a, b) => b.mvpValue - a.mvpValue)
      .map((row, i) => ({ ...row, calculatedRank: i + 1 })),
  );
  ranked.sort(
    (a, b) => compareDateKeys(b.date, a.date) || a.calculatedRank - b.calculatedRank,
  );

  mkdirSync(join(__dirname, "..", "src", "front-end", "public"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(ranked));

  logger.info(`wrote ${ranked.length} rows to ${OUT}`);
  logger.info(
    `days: ${windowKeys.length} scraped, ${calendar.length - windowKeys.length} gaps`,
  );

  await client.close();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
