// Migrates every stored ranking row to formula version 2.
//
//   pnpm migrate            dry run — reports what would change, writes nothing
//   pnpm migrate --apply    backs up, then writes
//
// Version 1 had no notion of availability: a player who appeared in 44% of his
// team's games was scored as though he had played every night. Version 2
// multiplies the whole score by gamesPlayed / teamGamesPlayed.
//
// Nothing is re-scraped. Every input the formula needs is already on each row —
// usage rate, VORP, win shares, box plus/minus, true shooting, the box score,
// the team record — captured on the day it was collected and irreplaceable
// today. The one missing field, gamesPlayed, comes from .cache/game-logs.json
// (build it with `pnpm fetch-game-logs`).
//
// Also fills teamLosses, which the scraper read and discarded, and stores every
// intermediate term of the formula so the front end never has to recompute one.

import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import logger from "../src/utils/logger";
import { compareDateKeys, parseDateKey } from "../src/utils/date-key";
import { scoreBreakdown } from "../src/shared/mvp-formula";
import { CURRENT_FORMULA_VERSION } from "../src/utils/types";
import {
  gamesPlayedAtTeamGame,
  teamRecordAsOf,
  type GameLogEntry,
} from "../src/services/scraper/scrape-player-game-log";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const CACHE_FILE = join(__dirname, "..", ".cache", "game-logs.json");
const BACKUP_DIR = join(__dirname, "..", "backups");

type Cache = {
  season: string;
  players: Record<string, { profileUrl: string; entries: GameLogEntry[] }>;
};

function isoOf(dateKey: string): string {
  const d = parseDateKey(dateKey);
  if (!d) throw new Error(`Unparseable date key: ${dateKey}`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const f = (n: number, w = 6) => n.toFixed(3).padStart(w);

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  if (!existsSync(CACHE_FILE)) {
    throw new Error(`No ${CACHE_FILE}. Run \`pnpm fetch-game-logs\` first.`);
  }
  const cache: Cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db("NbaDb").collection("DailyMvpRankings");

  const rows = await col.find({}).toArray();
  logger.info(`${rows.length} rows loaded, ${Object.keys(cache.players).length} cached logs`);

  // ── Every player must have a log ─────────────────────────────────────────
  //
  // A missing log yields gamesPlayed 0, availability 0, and a score of zero.
  // That is not a visible failure — it is a plausible-looking last place. Stop
  // before writing anything rather than bury someone silently.
  const missing = [...new Set(rows.map((r) => r.player))].filter(
    (p) => !cache.players[p],
  );
  if (missing.length > 0) {
    throw new Error(`No cached game log for: ${missing.join(", ")}`);
  }

  // ── Recompute ────────────────────────────────────────────────────────────
  const repairs: string[] = [];

  const computed = rows.map((r) => {
    const entries = cache.players[r.player].entries;
    const iso = isoOf(r.date);

    // Repair a broken team record.
    //
    // One row (11-26-2025, Cade Cunningham) has teamWins null and
    // teamGamesPlayed 0: the team-page scrape failed that night and the row was
    // stored anyway. Its v1 score has been wrong ever since — the win-ratio
    // guard returned 0, so it recorded only the Total Stats half and still
    // looked like a perfectly ordinary number.
    //
    // The player's game log lists every game his team played, won or lost,
    // including the ones he missed, so the record is recoverable from a source
    // independent of the page that failed. This is a repair, not a guess.
    let teamWins = r.teamWins as number | null;
    let teamGamesPlayed = r.teamGamesPlayed as number;

    if (teamWins == null || !teamGamesPlayed) {
      const rec = teamRecordAsOf(entries, iso);
      repairs.push(
        `${r.date} ${r.player}: teamWins ${teamWins} -> ${rec.wins}, ` +
          `teamGamesPlayed ${teamGamesPlayed} -> ${rec.gamesPlayed}`,
      );
      teamWins = rec.wins;
      teamGamesPlayed = rec.gamesPlayed;
    }

    // Anchored on the team's game number, not the row's date.
    //
    // The scraper reads the team page at a fixed hour, so a row dated 11-26 can
    // record 17 team games while the team played its 18th that evening. Walking
    // the log by date then counts a game the row does not know about, and
    // availability comes out above 1 — it did, on 137 rows, until this changed.
    // The team game number is the same clock on both sides.
    const gamesPlayed = gamesPlayedAtTeamGame(entries, teamGamesPlayed);

    // Field by field, not a spread: the driver types documents as opaque, so a
    // spread would let a missing field through a cast and score it as zero.
    const input = {
      teamWins,
      teamGamesPlayed,
      gamesPlayed,
      minutesPerGame: r.minutesPerGame as number,
      usageRate: r.usageRate as number,
      valueOverReplacement: r.valueOverReplacement as number,
      winShare: r.winShare as number,
      boxPlusMinus: r.boxPlusMinus as number,
      pointsPerGame: r.pointsPerGame as number,
      assistsPerGame: r.assistsPerGame as number,
      reboundsPerGame: r.reboundsPerGame as number,
      blocksPerGame: r.blocksPerGame as number,
      stealsPerGame: r.stealsPerGame as number,
      foulsPerGame: r.foulsPerGame as number,
      turnoversPerGame: r.turnoversPerGame as number,
      trueShootingPercentage: r.trueShootingPercentage as number,
    };

    return {
      _id: r._id,
      date: r.date as string,
      player: r.player as string,
      oldValue: r.mvpValue as number,
      oldRank: r.calculatedRank as number,
      gamesPlayed,
      teamWins,
      teamGamesPlayed,
      // The scraper reads losses to compute teamGamesPlayed, then throws them
      // away. Recover exactly, no guessing.
      teamLosses: teamGamesPlayed - teamWins,
      ...scoreBreakdown(input),
    };
  });

  if (repairs.length > 0) {
    console.log(`\n  repaired ${repairs.length} row(s) with a broken team record:`);
    repairs.forEach((r) => console.log(`    ${r}`));
  }

  const zeroAvailability = computed.filter((c) => c.availability === 0);
  if (zeroAvailability.length > 0) {
    const sample = zeroAvailability.slice(0, 5).map((c) => `${c.date} ${c.player}`);
    throw new Error(
      `${zeroAvailability.length} rows would score zero availability ` +
        `(e.g. ${sample.join("; ")}). Refusing to write.`,
    );
  }

  // ── Re-rank within each date ─────────────────────────────────────────────
  const byDate = new Map<string, typeof computed>();
  for (const c of computed) {
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }
  const ranked = [...byDate.values()].flatMap((list) =>
    [...list]
      .sort((a, b) => b.mvpValue - a.mvpValue)
      .map((c, i) => ({ ...c, newRank: i + 1 })),
  );

  // ── Report ───────────────────────────────────────────────────────────────
  const movedRank = ranked.filter((r) => r.newRank !== r.oldRank);
  const dates = [...byDate.keys()].sort(compareDateKeys);

  console.log(`\n  rows              ${ranked.length}`);
  console.log(`  dates             ${dates.length}`);
  console.log(`  changed rank      ${movedRank.length} (${((movedRank.length / ranked.length) * 100).toFixed(0)}%)`);

  const byPlayer = new Map<string, { drop: number; n: number }>();
  for (const r of ranked) {
    const e = byPlayer.get(r.player) ?? { drop: 0, n: 0 };
    e.drop += r.newRank - r.oldRank;
    e.n++;
    byPlayer.set(r.player, e);
  }
  const movers = [...byPlayer]
    .map(([p, e]) => ({ p, avg: e.drop / e.n }))
    .sort((a, b) => b.avg - a.avg);

  console.log("\n  average rank change (positive = fell)");
  movers.slice(0, 5).forEach((m) => console.log(`    ${m.p.padEnd(24)} ${m.avg > 0 ? "+" : ""}${m.avg.toFixed(1)}`));
  console.log("    ...");
  movers.slice(-3).forEach((m) => console.log(`    ${m.p.padEnd(24)} ${m.avg > 0 ? "+" : ""}${m.avg.toFixed(1)}`));

  for (const sample of [dates[Math.floor(dates.length / 2)], dates[dates.length - 1]]) {
    const day = ranked.filter((r) => r.date === sample);
    console.log(`\n  ${sample} — top 5`);
    console.log("    was                              ->  now");
    const before = [...day].sort((a, b) => a.oldRank - b.oldRank).slice(0, 5);
    const after = [...day].sort((a, b) => a.newRank - b.newRank).slice(0, 5);
    for (let i = 0; i < 5; i++) {
      const b = before[i], a = after[i];
      console.log(
        `    ${String(i + 1).padStart(2)} ${b.player.padEnd(23)} ${f(b.oldValue)}` +
          `  ->  ${String(i + 1).padStart(2)} ${a.player.padEnd(23)} ${f(a.mvpValue)}` +
          `  avail ${(a.availability * 100).toFixed(0)}%`,
      );
    }
  }

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    await client.close();
    return;
  }

  // ── Back up, then write ──────────────────────────────────────────────────
  mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = join(
    BACKUP_DIR,
    `DailyMvpRankings-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(backup, JSON.stringify(rows));
  logger.info(`backed up ${rows.length} rows to ${backup}`);

  const ops: AnyBulkWriteOperation[] = ranked.map((r) => ({
    updateOne: {
      filter: { _id: r._id },
      update: {
        $set: {
          gamesPlayed: r.gamesPlayed,
          teamWins: r.teamWins,
          teamGamesPlayed: r.teamGamesPlayed,
          teamLosses: r.teamLosses,
          teamWinRatio: r.teamWinRatio,
          availability: r.availability,
          minutesFactor: r.minutesFactor,
          usageFactor: r.usageFactor,
          levelOfImpact: r.levelOfImpact,
          qualityOfImpact: r.qualityOfImpact,
          winContribution: r.winContribution,
          totalStats: r.totalStats,
          rawValue: r.rawValue,
          mvpValue: r.mvpValue,
          calculatedRank: r.newRank,
          formulaVersion: CURRENT_FORMULA_VERSION,
        },
      },
    },
  }));

  const res = await col.bulkWrite(ops, { ordered: false });
  logger.info(`matched ${res.matchedCount}, modified ${res.modifiedCount}`);

  await client.close();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
