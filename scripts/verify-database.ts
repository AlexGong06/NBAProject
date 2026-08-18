// Independently verifies what is actually stored in MongoDB.
//
//   pnpm verify-db              full check
//   pnpm verify-db --sample 50  recompute this many player-dates (default 200)
//
// The season build already checks its own output before writing. This checks
// the database afterwards, and — the part that matters — recomputes scores from
// the raw game logs rather than trusting the numbers it is checking.
//
// If `build-season` had a bug, its self-checks would share it. So the recompute
// here starts from `PlayerGameLogs2526`, the untouched event source, and
// rebuilds season-to-date and the formula from scratch. Agreement across both
// paths means the stored value is right; disagreement localises the fault
// immediately, because only one of the two can be wrong.
//
// Read-only. Writes nothing, changes nothing.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";
import { scoreBreakdown } from "../src/shared/mvp-formula";
import { CURRENT_FORMULA_VERSION } from "../src/utils/types";
import type { PlayerGame, TeamGame } from "../src/services/nba-api/fetch-season";
import {
  indexPlayerGames,
  indexTeamGames,
  seasonToDate,
} from "../src/services/nba-api/season-to-date";

dotenv.config();

const sampleArg = process.argv.indexOf("--sample");
const SAMPLE_SIZE = sampleArg > -1 ? Number(process.argv[sampleArg + 1]) : 200;
const TOLERANCE = 1e-6;

const failures: string[] = [];
const fail = (what: string) => {
  if (failures.length < 30) failures.push(what);
};

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) fail(label);
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("NbaDb");

  try {
    const daily = db.collection("PlayerDailyValues");
    const logs = db.collection("PlayerGameLogs2526");

    // ── Shape ────────────────────────────────────────────────────────────
    console.log("\n── Collections ──────────────────────────────────────────");
    const dailyCount = await daily.countDocuments();
    const logCount = await logs.countDocuments();
    const dates = (await daily.distinct("isoDate")).sort();
    const players = await daily.distinct("playerId");

    console.log(`  PlayerDailyValues   ${dailyCount} rows`);
    console.log(`  PlayerGameLogs2526  ${logCount} rows`);
    console.log(`  dates               ${dates.length}  (${dates[0]} → ${dates[dates.length - 1]})`);
    console.log(`  players             ${players.length}`);

    console.log("\n── Invariants over every stored row ─────────────────────");

    // Streamed, because 83,054 wide rows will not fit in the aggregation
    // framework's memory limit and there is no reason to hold them all.
    let scanned = 0;
    let badAvailability = 0;
    let badIdentity = 0;
    let nonFinite = 0;
    let wrongVersion = 0;
    let gpOverTeamGp = 0;
    let winsOverGames = 0;

    const cursor = daily.find({}, { projection: { _id: 0 } });
    for await (const row of cursor) {
      scanned++;

      for (const value of Object.values(row)) {
        if (typeof value === "number" && !Number.isFinite(value)) {
          nonFinite++;
          fail(`non-finite value on ${row.isoDate} ${row.player}`);
          break;
        }
      }
      if (row.formulaVersion !== CURRENT_FORMULA_VERSION) wrongVersion++;
      if (!(row.availability > 0 && row.availability <= 1)) {
        badAvailability++;
        fail(`availability ${row.availability} on ${row.isoDate} ${row.player}`);
      }
      if (row.gamesPlayed > row.teamGamesPlayed) gpOverTeamGp++;
      if (row.teamWins > row.teamGamesPlayed) winsOverGames++;

      // The two identities the front end relies on when it draws the split bar
      // and the formula panel. If these drift, the panel shows working that
      // does not add up to the total printed beside it.
      const rawOk = Math.abs(0.5 * row.winContribution + 0.5 * row.totalStats - row.rawValue) < TOLERANCE;
      const mvpOk = Math.abs(row.availability * row.rawValue - row.mvpValue) < TOLERANCE;
      if (!rawOk || !mvpOk) {
        badIdentity++;
        fail(`breakdown does not reconcile on ${row.isoDate} ${row.player}`);
      }
    }

    check("all rows scanned", scanned === dailyCount, `${scanned}`);
    check("no non-finite numbers", nonFinite === 0, `${nonFinite} bad`);
    check("availability in (0, 1]", badAvailability === 0, `${badAvailability} bad`);
    check("gamesPlayed ≤ teamGamesPlayed", gpOverTeamGp === 0, `${gpOverTeamGp} bad`);
    check("teamWins ≤ teamGamesPlayed", winsOverGames === 0, `${winsOverGames} bad`);
    check("breakdown reconciles with score", badIdentity === 0, `${badIdentity} bad`);
    check(`every row is formula v${CURRENT_FORMULA_VERSION}`, wrongVersion === 0, `${wrongVersion} bad`);

    // ── Independent recompute from the event source ──────────────────────
    console.log("\n── Recomputed from raw game logs ────────────────────────");

    const allGames = (await logs.find({}, { projection: { _id: 0 } }).toArray()) as unknown as PlayerGame[];
    const byPlayer = indexPlayerGames(allGames);

    // Team games are reconstructed from the player logs: every player-game
    // carries its team, game id, date and result, so the distinct set of
    // (teamId, gameId) is the team's schedule. Deriving it here rather than
    // re-fetching keeps this check offline and independent of the API.
    const teamGameMap = new Map<string, TeamGame>();
    for (const g of allGames) {
      const key = `${g.teamId}:${g.gameId}`;
      if (!teamGameMap.has(key) && g.won !== null) {
        teamGameMap.set(key, {
          teamId: g.teamId, teamAbbr: g.teamAbbr, gameId: g.gameId,
          date: g.date, won: g.won,
        });
      }
    }
    const byTeam = indexTeamGames([...teamGameMap.values()]);
    console.log(`  reconstructed ${teamGameMap.size} team-games from ${allGames.length} player-games`);

    const sample = await daily
      .aggregate([{ $sample: { size: SAMPLE_SIZE } }])
      .toArray();

    let compared = 0;
    let mismatched = 0;
    let worst = 0;
    let worstWhere = "";

    for (const stored of sample) {
      const games = byPlayer.get(stored.playerId);
      if (!games) {
        fail(`no game logs for ${stored.player} (${stored.playerId})`);
        continue;
      }

      const recomputedStats = seasonToDate(games, byTeam, stored.isoDate);
      if (!recomputedStats) {
        fail(`recompute produced nothing for ${stored.player} on ${stored.isoDate}`);
        continue;
      }
      const recomputed = scoreBreakdown(recomputedStats);
      compared++;

      const diff = Math.abs(recomputed.mvpValue - stored.mvpValue);
      if (diff > worst) {
        worst = diff;
        worstWhere = `${stored.isoDate} ${stored.player}`;
      }
      if (
        diff > TOLERANCE ||
        recomputedStats.gamesPlayed !== stored.gamesPlayed ||
        recomputedStats.teamGamesPlayed !== stored.teamGamesPlayed ||
        Math.abs(recomputedStats.pie - stored.pie) > TOLERANCE ||
        Math.abs(recomputedStats.netRating - stored.netRating) > TOLERANCE
      ) {
        mismatched++;
        fail(
          `${stored.isoDate} ${stored.player}: stored mvp ${stored.mvpValue.toFixed(6)} ` +
            `vs recomputed ${recomputed.mvpValue.toFixed(6)} ` +
            `(GP ${stored.gamesPlayed}/${stored.teamGamesPlayed} vs ` +
            `${recomputedStats.gamesPlayed}/${recomputedStats.teamGamesPlayed})`,
        );
      }
    }

    check(`recomputed ${compared} sampled player-dates`, compared === sample.length);
    check("every recomputed score matches what is stored", mismatched === 0, `${mismatched} mismatched`);
    console.log(`  largest disagreement: ${worst.toExponential(2)}${worstWhere ? `  (${worstWhere})` : ""}`);

    // ── Ranking behaves ──────────────────────────────────────────────────
    console.log("\n── Ranking on read ──────────────────────────────────────");
    const lastDate = dates[dates.length - 1];
    const board = await daily.find({ isoDate: lastDate }).sort({ mvpValue: -1 }).limit(10).toArray();

    const descending = board.every((r, i) => i === 0 || board[i - 1].mvpValue >= r.mvpValue);
    check("final board is ordered by score", descending);
    check("no rank is stored on any row", !("calculatedRank" in (board[0] ?? {})));

    console.log(`\n  ${lastDate} — top 5`);
    board.slice(0, 5).forEach((r, i) =>
      console.log(
        `    ${i + 1} ${r.player.padEnd(24)} ${r.mvpValue.toFixed(3)}  ` +
          `PIE ${(r.pie * 100).toFixed(1)}  NRTG ${r.netRating.toFixed(1)}  ` +
          `${r.gamesPlayed}/${r.teamGamesPlayed}`,
      ),
    );

    // ── Verdict ──────────────────────────────────────────────────────────
    console.log("\n─────────────────────────────────────────────────────────");
    if (failures.length > 0) {
      console.log(`  ${failures.length} PROBLEM(S):\n`);
      failures.forEach((f) => console.log(`    ${f}`));
      console.log("");
      process.exitCode = 1;
      return;
    }
    console.log("  Everything checks out.\n");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
