// Checks the game log and the game summaries against each other.
//
//   pnpm verify-games
//
// Read-only. Two collections describe the same 1,230 games from different
// sources — the player game logs from `playergamelogs`, the summaries from
// `scoreboardv3` — so each can check the other, and a disagreement is a real
// ingestion bug rather than a matter of taste.
//
// The load-bearing claim this defends: **a game's final score is the sum of its
// players' points.** The game view relies on it, and if it ever stops holding,
// every box score in the app is quietly wrong while still looking like a box
// score. Zero-minute appearances are dropped at ingestion and score nothing, so
// the sum is exact rather than approximate.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";

dotenv.config();

const LOGS = "PlayerGameLogs2526";
const SUMMARIES = "GameSummaries2526";

type Check = { label: string; failures: number; detail?: string };

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("NbaDb");
    const logs = await db.collection(LOGS).find({}).toArray();
    const summaries = await db.collection(SUMMARIES).find({}).toArray();
    const byId = new Map(summaries.map((s) => [s.gameId, s]));

    const byGame = new Map<string, any[]>();
    for (const r of logs) {
      if (!byGame.has(r.gameId)) byGame.set(r.gameId, []);
      byGame.get(r.gameId)!.push(r);
    }

    const c = {
      score: 0, quarters: 0, overtime: 0, home: 0, opponent: 0, won: 0,
      noSummary: 0, fgm: 0, tpm: 0, ftm: 0, reb: 0, threesVsFg: 0,
    };
    const examples: string[] = [];

    for (const [gameId, rows] of byGame) {
      const s = byId.get(gameId);
      if (!s) { c.noSummary++; continue; }

      const side = (teamId: number) => rows.filter((r) => r.teamId === teamId);
      const sum = (teamId: number) => side(teamId).reduce((a, r) => a + r.points, 0);

      if (sum(s.homeTeamId) !== s.homeScore || sum(s.awayTeamId) !== s.awayScore) {
        c.score++;
        if (examples.length < 5) {
          examples.push(
            `${gameId}: players sum to ${sum(s.awayTeamId)}-${sum(s.homeTeamId)}, ` +
              `scoreboard says ${s.awayScore}-${s.homeScore}`,
          );
        }
      }

      const total = (a: number[]) => a.reduce((x: number, y: number) => x + y, 0);
      if (total(s.homePeriods) !== s.homeScore || total(s.awayPeriods) !== s.awayScore) c.quarters++;

      // Regulation is 240 team-minutes; each extra period adds 25.
      const minutes = [s.homeTeamId, s.awayTeamId]
        .map((t) => side(t).reduce((a, r) => a + r.minutes, 0));
      if (Math.round((minutes[0] + minutes[1]) / 2 / 25 - 240 / 25) !== s.overtimePeriods) c.overtime++;

      for (const r of rows) {
        const isHomeSide = r.teamId === s.homeTeamId;
        // Skipped for neutral-site games: both sides read "@" there, so the
        // MATCHUP string cannot name a host and the summary is authoritative.
        if (!s.neutralSite && r.isHome !== isHomeSide) c.home++;
        if (r.opponentAbbr !== (isHomeSide ? s.awayAbbr : s.homeAbbr)) c.opponent++;
        const teamWon = (isHomeSide ? s.homeScore : s.awayScore) >
                        (isHomeSide ? s.awayScore : s.homeScore);
        if (r.won !== teamWon) c.won++;
      }
    }

    // A made shot that was never attempted, or a rebound split that does not
    // add up, means the column mapping slipped.
    for (const r of logs) {
      if (r.fieldGoalsMade > r.fieldGoalAttempts) c.fgm++;
      if (r.threesMade > r.threeAttempts) c.tpm++;
      if (r.freeThrowsMade > r.freeThrowAttempts) c.ftm++;
      if (r.offensiveRebounds + r.defensiveRebounds !== r.rebounds) c.reb++;
      if (r.threesMade > r.fieldGoalsMade) c.threesVsFg++;
    }

    const checks: Check[] = [
      { label: "games with no summary row", failures: c.noSummary },
      { label: "summed player points != scoreboard final", failures: c.score },
      { label: "quarter scores do not sum to the final", failures: c.quarters },
      { label: "overtime from minutes != overtime from periods", failures: c.overtime },
      { label: "home/away disagrees (excluding neutral sites)", failures: c.home },
      { label: "opponent disagrees", failures: c.opponent },
      { label: "stored won flag disagrees with the score", failures: c.won },
      { label: "field goals made > attempted", failures: c.fgm },
      { label: "threes made > attempted", failures: c.tpm },
      { label: "free throws made > attempted", failures: c.ftm },
      { label: "offensive + defensive rebounds != total", failures: c.reb },
      { label: "threes made > field goals made", failures: c.threesVsFg },
    ];

    logger.info(`${byGame.size} games · ${logs.length} player-games · ${summaries.length} summaries`);
    for (const check of checks) {
      const mark = check.failures === 0 ? "ok  " : "FAIL";
      logger.info(`  ${mark} ${check.label}: ${check.failures}`);
    }
    for (const e of examples) logger.warn(`  ${e}`);

    const failed = checks.filter((x) => x.failures > 0);
    if (failed.length) {
      throw new Error(`${failed.length} of ${checks.length} checks failed`);
    }
    logger.info("all checks passed");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
