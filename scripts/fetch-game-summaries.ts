// Fetches one summary row per game: final score, quarter scores, and which side
// was at home.
//
//   pnpm fetch-summaries            dry run — fetches, reports, writes nothing
//   pnpm fetch-summaries --apply    writes GameSummaries2526
//
// The game logs already give the final score (summed player points) and the
// overtime count (team minutes: 240 in regulation, +25 per period). The
// quarter-by-quarter line score is the one thing worth a request.
//
// **`boxscoresummaryv2` is broken for this season** — every 2025-26 game returns
// null quarters and a pre-game status, while 2023-24 works. Known NBA-side bug,
// swar/nba_api#596, closed by PR #609 deprecating v2 in favour of v3.
//
// `scoreboardv3` is keyed by DATE, so this is 164 requests rather than 1,230.
// It answers with named JSON rather than the `headers`/`rowSet` envelope, hence
// `nbaStatsJson` rather than `nbaStats`.

import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";
import { nbaStatsJson } from "../src/services/nba-api/client";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const LOG_COLLECTION = "PlayerGameLogs2526";
const SUMMARY_COLLECTION = "GameSummaries2526";

/**
 * Pause between requests.
 *
 * 164 sequential calls is a small enough job that there is no reason to hurry
 * it. This API declines by holding the connection open rather than refusing, so
 * an impatient loop fails as a timeout several minutes later.
 */
const THROTTLE_MS = 400;

type V3Team = {
  teamId: number;
  teamTricode: string;
  score: number;
  periods?: { period: number; periodType: string; score: number }[];
};

type V3Game = {
  gameId: string;
  gameStatusText: string;
  homeTeam: V3Team;
  awayTeam: V3Team;
};

type V3Response = { scoreboard?: { games?: V3Game[] } };

export type GameSummary = {
  _id: string;
  gameId: string;
  isoDate: string;
  statusText: string;
  homeTeamId: number;
  homeAbbr: string;
  homeScore: number;
  homePeriods: number[];
  awayTeamId: number;
  awayAbbr: string;
  awayScore: number;
  awayPeriods: number[];
  /** 0 for a regulation game. Derived from the period count, not from minutes. */
  overtimePeriods: number;
  /**
   * True when neither team was hosting — the NBA Cup games in Las Vegas, and
   * the league's international games.
   *
   * The scoreboard still nominates a home side for stat purposes, so
   * `homeTeamId` stays meaningful; this is what stops the UI captioning such a
   * game "Away" for one team and "Home" for the other when it was neither.
   */
  neutralSite: boolean;
};

const periodScores = (t: V3Team): number[] => (t.periods ?? []).map((p) => p.score);

function toSummary(g: V3Game, isoDate: string, neutralSite: boolean): GameSummary {
  const home = periodScores(g.homeTeam);
  const away = periodScores(g.awayTeam);
  return {
    neutralSite,
    _id: g.gameId,
    gameId: g.gameId,
    isoDate,
    statusText: g.gameStatusText,
    homeTeamId: g.homeTeam.teamId,
    homeAbbr: g.homeTeam.teamTricode,
    homeScore: g.homeTeam.score,
    homePeriods: home,
    awayTeamId: g.awayTeam.teamId,
    awayAbbr: g.awayTeam.teamTricode,
    awayScore: g.awayTeam.score,
    awayPeriods: away,
    // A regulation game has four periods; anything beyond them is overtime.
    overtimePeriods: Math.max(0, Math.max(home.length, away.length) - 4),
  };
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("NbaDb");

  try {
    // The dates to fetch come from the game logs rather than from a calendar:
    // the ten days the NBA did not play have no games to summarise.
    const dates: string[] = await db.collection(LOG_COLLECTION).distinct("date");
    dates.sort();
    logger.info(`${dates.length} game dates to fetch`);

    const knownGameIds = new Set<string>(
      await db.collection(LOG_COLLECTION).distinct("gameId"),
    );

    // A neutral-site game is one where no side's MATCHUP string claimed to be
    // hosting. The scoreboard nominates a home team regardless, so this is the
    // only signal that distinguishes "Denver at Golden State" from a Cup game
    // in Las Vegas where neither team was home.
    const hostedGameIds = new Set<string>(
      await db.collection(LOG_COLLECTION).distinct("gameId", { isHome: true }),
    );

    const summaries: GameSummary[] = [];
    const unscored: string[] = [];
    let extra = 0;

    for (const [i, isoDate] of dates.entries()) {
      const body = await nbaStatsJson<V3Response>("scoreboardv3", {
        GameDate: isoDate,
        LeagueID: "00",
      });

      for (const g of body.scoreboard?.games ?? []) {
        // The scoreboard for a date includes every game the league played that
        // day. Anything the game logs do not know about is not a regular-season
        // game we scored — preseason, All-Star, or a postseason date beyond our
        // range — and is skipped rather than stored.
        if (!knownGameIds.has(g.gameId)) {
          extra++;
          continue;
        }
        const s = toSummary(g, isoDate, !hostedGameIds.has(g.gameId));
        if (s.homeScore === 0 && s.awayScore === 0) unscored.push(g.gameId);
        summaries.push(s);
      }

      if ((i + 1) % 25 === 0 || i === dates.length - 1) {
        logger.info(`  ${i + 1}/${dates.length} dates · ${summaries.length} games`);
      }
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    // ── Gates ──────────────────────────────────────────────────────────────
    //
    // The point of this script is the line score. A summary with no periods is
    // worse than no summary at all: it renders as a row of blanks under a real
    // header, which reads as a rendering bug rather than a missing fetch.
    const missing = [...knownGameIds].filter(
      (id) => !summaries.some((s) => s.gameId === id),
    );
    const noPeriods = summaries.filter((s) => s.homePeriods.length === 0);

    logger.info(
      `fetched ${summaries.length} summaries · ${extra} non-regular-season games skipped`,
    );
    if (missing.length) {
      logger.warn(`${missing.length} games in the logs have no summary: ${missing.slice(0, 5).join(", ")}`);
    }
    if (noPeriods.length) {
      throw new Error(
        `${noPeriods.length} summaries came back with no quarter scores ` +
          `(e.g. ${noPeriods.slice(0, 3).map((s) => s.gameId).join(", ")}). ` +
          `That is the v2 failure mode this script exists to avoid — check that ` +
          `scoreboardv3 is still returning periods before writing.`,
      );
    }
    if (unscored.length) {
      throw new Error(`${unscored.length} summaries have a 0-0 final: ${unscored.slice(0, 3).join(", ")}`);
    }

    const withOt = summaries.filter((s) => s.overtimePeriods > 0).length;
    const neutral = summaries.filter((s) => s.neutralSite);
    logger.info(`${withOt} games went to overtime`);
    logger.info(
      `${neutral.length} played at a neutral site: ` +
        neutral.map((s) => `${s.awayAbbr}/${s.homeAbbr} ${s.isoDate}`).join(", "),
    );

    const sample = summaries[0];
    logger.info(
      `sample: ${sample.awayAbbr} ${sample.awayScore} @ ${sample.homeAbbr} ${sample.homeScore} ` +
        `(${sample.statusText}) Q=${sample.homePeriods.join("/")}`,
    );

    if (!APPLY) {
      logger.info("dry run — nothing written. Re-run with --apply.");
      return;
    }

    const ops: AnyBulkWriteOperation[] = summaries.map((s) => ({
      replaceOne: { filter: { _id: s._id as never }, replacement: s as never, upsert: true },
    }));
    const result = await db.collection(SUMMARY_COLLECTION).bulkWrite(ops, { ordered: false });
    // matched and modified both count a replaced document, so summing all three
    // reports twice the number of rows that exist.
    logger.info(
      `wrote ${result.upsertedCount + result.matchedCount} summaries ` +
        `(${result.upsertedCount} new, ${result.modifiedCount} changed)`,
    );

    await db.collection(SUMMARY_COLLECTION).createIndex({ isoDate: 1 });
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
