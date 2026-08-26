// Rebuilds a whole season from the NBA API.
//
//   pnpm build-season            dry run — computes everything, writes nothing
//   pnpm build-season --apply    writes both collections
//
// Five requests give every player-game of the season; from those, every player
// who has debuted gets season-to-date figures and an MVP value on each of the
// ~164 game dates. Roughly 87,000 rows, computed in memory, verified, written.
//
//   PlayerGameLogs2526   raw fact, exactly as the API returned it. Keeping it
//                        makes a formula change a recompute, not a re-fetch.
//   PlayerDailyValues    one row per player per date: inputs, every term, score.
//
// No rank is stored — see DailyValueRowSchema. Both use deterministic _ids, so
// re-running is idempotent rather than duplicating the season.

import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";
import { toDateKey } from "../src/utils/date-key";
import { scoreBreakdown } from "../src/shared/mvp-formula";
import {
  CURRENT_FORMULA_VERSION,
  DailyValueRowSchema,
  type DailyValueRow,
} from "../src/utils/types";
import {
  fetchPlayerBios,
  fetchSeason,
  type PlayerBio,
  type PlayerGame,
} from "../src/services/nba-api/fetch-season";
import {
  gameDates,
  indexPlayerGames,
  indexTeamGames,
  seasonToDate,
} from "../src/services/nba-api/season-to-date";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const SEASON = process.env.NBA_SEASON_LABEL || "2025-26";
const GAME_LOG_COLLECTION = "PlayerGameLogs2526";
const DAILY_COLLECTION = "PlayerDailyValues";
const BATCH = 5000;

/**
 * Turn an ISO date into the "M-D-YYYY" key the rest of the app queries by.
 *
 * Built from the parts rather than `new Date(iso)`, which parses a bare ISO
 * date as UTC midnight and then renders it in local time — shifting every date
 * in the season back a day for anyone west of Greenwich.
 */
function dateKeyOf(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return toDateKey(new Date(year, month - 1, day));
}

function profileUrlOf(playerId: number, bio: PlayerBio | undefined): string {
  return bio?.slug
    ? `https://www.nba.com/player/${playerId}/${bio.slug}`
    : `https://www.nba.com/player/${playerId}`;
}

/** The team he most recently appeared for, at or before `upto`. */
function teamAsOf(games: PlayerGame[], upto: string): PlayerGame {
  let latest = games[0];
  for (const g of games) {
    if (g.date <= upto) latest = g;
    else break;
  }
  return latest;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  logger.info(`fetching season ${SEASON}`);
  const started = Date.now();
  const [season, bios] = await Promise.all([
    fetchSeason(SEASON),
    fetchPlayerBios(SEASON),
  ]);
  logger.info(
    `${season.playerGames.length} player-games, ${season.teamGames.length} team-games, ` +
      `${bios.size} bios in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  const byPlayer = indexPlayerGames(season.playerGames);
  const byTeam = indexTeamGames(season.teamGames);
  const dates = gameDates(season.playerGames);

  logger.info(`${byPlayer.size} players across ${dates.length} dates`);

  // ── Compute ──────────────────────────────────────────────────────────────
  const rows: DailyValueRow[] = [];

  for (const [playerId, games] of byPlayer) {
    const bio = bios.get(playerId);
    const debut = games[0].date;

    for (const iso of dates) {
      // Nothing to report before a player's first game. A zero here would put
      // him on the board in last place rather than leaving him off it.
      if (iso < debut) continue;

      const stats = seasonToDate(games, byTeam, iso);
      if (!stats) continue;

      const current = teamAsOf(games, iso);
      const breakdown = scoreBreakdown(stats);

      rows.push({
        date: dateKeyOf(iso),
        isoDate: iso,
        playerId,
        player: current.playerName,
        team: current.teamAbbr,
        teamId: current.teamId,
        profileUrl: profileUrlOf(playerId, bio),
        pos: bio?.position ?? null,
        age: bio?.age ?? null,
        gamesPlayed: stats.gamesPlayed,
        teamGamesPlayed: stats.teamGamesPlayed,
        teamWins: stats.teamWins,
        teamLosses: stats.teamGamesPlayed - stats.teamWins,
        minutesPerGame: stats.minutesPerGame,
        pointsPerGame: stats.pointsPerGame,
        assistsPerGame: stats.assistsPerGame,
        reboundsPerGame: stats.reboundsPerGame,
        blocksPerGame: stats.blocksPerGame,
        stealsPerGame: stats.stealsPerGame,
        foulsPerGame: stats.foulsPerGame,
        turnoversPerGame: stats.turnoversPerGame,
        usageRate: stats.usageRate,
        pie: stats.pie,
        trueShootingPercentage: stats.trueShootingPercentage,
        netRating: stats.netRating,
        totalMinutes: stats.totalMinutes,
        totalPossessions: stats.totalPossessions,
        formulaVersion: CURRENT_FORMULA_VERSION,
        ...breakdown,
      });
    }
  }

  logger.info(`computed ${rows.length} daily rows`);

  // ── Verify before writing ────────────────────────────────────────────────
  //
  // Every one of these describes a bug that produces plausible output. A NaN
  // sorts unpredictably rather than throwing; an availability above 1 rewards a
  // player for being traded; a season PIE above 0.35 means the aggregation is
  // weighting by the wrong denominator. Checking 87,000 rows costs a second and
  // is the difference between finding this now and finding it in the UI.
  const problems: string[] = [];
  const note = (row: DailyValueRow, why: string) => {
    if (problems.length < 20) problems.push(`${row.isoDate} ${row.player}: ${why}`);
  };

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        note(row, `${key} is ${value}`);
      }
    }
    if (row.gamesPlayed > row.teamGamesPlayed) {
      note(row, `played ${row.gamesPlayed} of ${row.teamGamesPlayed} team games`);
    }
    if (row.availability <= 0 || row.availability > 1) {
      note(row, `availability ${row.availability.toFixed(4)}`);
    }
    if (row.teamWins > row.teamGamesPlayed) {
      note(row, `${row.teamWins} wins in ${row.teamGamesPlayed} games`);
    }
    // Range checks on the rates have to know how big the sample is.
    //
    // A season-to-date PIE above 0.35 means the weighting is wrong — but only
    // once there is a season to speak of. Over one game it just means somebody
    // had a huge night: Wembanyama opened at 0.432 and settled at 0.208 by
    // April, which is convergence working, not a bug. Measured across this
    // season, 168 rows breach 0.35 and every one is at 7 games or fewer; none
    // at 10 or more. So 10 games is where the check starts to mean something.
    if (row.gamesPlayed >= 10) {
      if (row.pie > 0.35 || row.pie < -0.35) {
        note(row, `season PIE ${row.pie.toFixed(4)} over ${row.gamesPlayed} games — check aggregation weights`);
      }
      if (row.usageRate > 0.55 || row.usageRate < 0) {
        note(row, `season usage ${row.usageRate.toFixed(4)} over ${row.gamesPlayed} games`);
      }
    }
    // Small samples still get a loose bound. A single game's PIE tops out near
    // 6.0 in this season's data, so anything beyond that is not a hot night —
    // it is an aggregation that has lost its denominator.
    if (Math.abs(row.pie) > 6.5 || row.usageRate > 1.5 || row.usageRate < 0) {
      note(row, `PIE ${row.pie.toFixed(3)} / usage ${row.usageRate.toFixed(3)} — beyond any single game`);
    }
    if (Math.abs(row.availability * row.rawValue - row.mvpValue) > 1e-9) {
      note(row, "availability × rawValue ≠ mvpValue");
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `${problems.length}+ invalid rows. Refusing to write.\n  ` +
        problems.join("\n  "),
    );
  }

  // Zod is the second gate: it catches a field that is missing entirely, which
  // the numeric checks above cannot see.
  DailyValueRowSchema.parse(rows[0]);
  DailyValueRowSchema.parse(rows[rows.length - 1]);

  // ── Report ───────────────────────────────────────────────────────────────
  const lastDate = dates[dates.length - 1];
  const finalDay = rows
    .filter((r) => r.isoDate === lastDate)
    .sort((a, b) => b.mvpValue - a.mvpValue);

  console.log(`\n  season            ${SEASON}`);
  console.log(`  players           ${byPlayer.size}`);
  console.log(`  dates             ${dates.length}  (${dates[0]} → ${lastDate})`);
  console.log(`  game log rows     ${season.playerGames.length}`);
  console.log(`  daily value rows  ${rows.length}`);

  console.log(`\n  ${lastDate} — top 10`);
  console.log("     player                   team   MVP    PIE    NRTG   avail  GP");
  finalDay.slice(0, 10).forEach((r, i) => {
    console.log(
      `    ${String(i + 1).padStart(2)} ${r.player.padEnd(24)} ${r.team.padEnd(4)} ` +
        `${r.mvpValue.toFixed(3).padStart(6)} ${(r.pie * 100).toFixed(1).padStart(6)} ` +
        `${r.netRating.toFixed(1).padStart(6)} ${(r.availability * 100).toFixed(0).padStart(5)}% ` +
        `${String(r.gamesPlayed).padStart(3)}`,
    );
  });

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    return;
  }

  // ── Write ────────────────────────────────────────────────────────────────
  //
  // bulkWrite with ordered:false, in batches. The sequential replaceOne the old
  // pipeline used is one round trip per row — fine for 20 rows a night, about
  // an hour for 87,000.
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("NbaDb");

  try {
    const logOps: AnyBulkWriteOperation[] = season.playerGames.map((g) => ({
      replaceOne: {
        filter: { _id: `${g.playerId}:${g.gameId}` as never },
        replacement: { ...g, _id: `${g.playerId}:${g.gameId}` } as never,
        upsert: true,
      },
    }));

    const valueOps: AnyBulkWriteOperation[] = rows.map((r) => ({
      replaceOne: {
        filter: { _id: `${r.playerId}:${r.isoDate}` as never },
        replacement: { ...r, _id: `${r.playerId}:${r.isoDate}` } as never,
        upsert: true,
      },
    }));

    for (const [name, ops] of [
      [GAME_LOG_COLLECTION, logOps],
      [DAILY_COLLECTION, valueOps],
    ] as const) {
      const col = db.collection(name);
      let written = 0;
      for (let i = 0; i < ops.length; i += BATCH) {
        const result = await col.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
        written += result.upsertedCount + result.modifiedCount + result.matchedCount;
        logger.info(`${name}: ${Math.min(i + BATCH, ops.length)}/${ops.length}`);
      }
      logger.info(`${name}: ${written} rows written`);
    }

    // Every read is "one date, best first". Both date forms are indexed because
    // both are used: `date` is the public "M-D-YYYY" query key, `isoDate` is
    // what the all-dates route walks. Without these the API sorts in memory and
    // dies at 83,054 rows with QueryExceededMemoryLimitNoDiskUseAllowed.
    await db.collection(DAILY_COLLECTION).createIndex({ date: 1, mvpValue: -1 });
    await db.collection(DAILY_COLLECTION).createIndex({ isoDate: 1, mvpValue: -1 });
    await db.collection(DAILY_COLLECTION).createIndex({ player: 1, isoDate: 1 });

    // Covers /calendar/series completely: filter, sort and both projected
    // fields are all in the index, so the query answers 8,200 rows without
    // touching a document. Without `player` on the end it is the same query
    // that took 1.5s.
    await db
      .collection(DAILY_COLLECTION)
      .createIndex({ isoDate: 1, mvpValue: -1, player: 1 }, { name: "series_covering" });

    // The game log had only `_id` until the game view needed to read it. Its two
    // questions are "this player's most recent game on or before a date" and
    // "every row of this game", and without these each is a scan of 26,638 wide
    // documents on every request.
    await db.collection(GAME_LOG_COLLECTION).createIndex({ playerId: 1, date: -1 });
    await db.collection(GAME_LOG_COLLECTION).createIndex({ gameId: 1 });
    await db.collection(GAME_LOG_COLLECTION).createIndex({ playerName: 1, date: -1 });
    logger.info("indexes ensured");
  } finally {
    await client.close();
  }

  console.log("\n  Done.\n");
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
