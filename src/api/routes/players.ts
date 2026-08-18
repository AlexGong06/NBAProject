import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { Router } from "express";

const playersRouter = Router();

/**
 * Fields the search index needs. Deliberately not the whole row.
 *
 * This endpoint exists so every player in the league is findable, which means
 * it returns all 582 of them — the board endpoints return a top N per date and
 * only 137 players ever reach a top 50 all season. Sending complete rows for
 * everyone would be ~400 KB to power a text search over names.
 */
const INDEX_PROJECTION = {
  _id: 0,
  player: 1, team: 1, pos: 1, playerId: 1, profileUrl: 1,
  pointsPerGame: 1, mvpValue: 1, gamesPlayed: 1, teamGamesPlayed: 1,
} as const;

// GET /players
// Every player in the league, as of the most recent date, best first.
//
// Every player who has debuted carries a row on every subsequent date, so the
// latest date holds the complete roster — one indexed query rather than a
// group-by-player over 83,054 rows, which would exceed Mongo's memory limit.
playersRouter.get("/", async (_req, res) => {
  try {
    const db = await getDb();
    const col = db.collection("PlayerDailyValues");

    const dates: string[] = await col.distinct("isoDate");
    if (dates.length === 0) {
      res.status(404).json({ message: "No rankings data available." });
      return;
    }
    dates.sort(); // ISO, so lexicographic is chronological

    const rows = await col
      .find({ isoDate: dates[dates.length - 1] }, { projection: INDEX_PROJECTION })
      .sort({ mvpValue: -1 })
      .toArray();

    res.json(rows);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

// GET /api/players/:playerName/daily-mvp-rankings
// One player's whole season, most recent first. Feeds the profile chart.
playersRouter.get("/:playerName/daily-mvp-rankings", async (req, res) => {
  const playerName = req.params.playerName;

  try {
    const db = await getDb();
    // Sorted in Mongo on `isoDate`, which is chronological as text. The
    // "M-D-YYYY" key is not — "9-30-2025" sorts above "2-17-2026" — and this
    // endpoint draws a line chart, so getting that wrong plots the season out
    // of order. Every row carries the ISO twin for this reason.
    const col = db.collection("PlayerDailyValues");
    const results = await col
      .find({ player: playerName })
      .sort({ isoDate: -1 })
      .toArray();

    if (results.length === 0) {
      res.status(404).json({ message: `No rankings found for ${playerName}.` });
      return;
    }

    // Rank is attached here, not stored — the same rule the board endpoints
    // follow. A player's position on a date is "how many players scored higher
    // that day, plus one", which is an index-only count against
    // { isoDate: 1, mvpValue: -1 } and needs none of the rows themselves.
    //
    // This matters for players outside the loaded board. The profile chart
    // defaults to plotting rank, and someone who never reached a top 50 has no
    // rank the client could derive from what it holds — their chart would
    // simply be empty. Measured at ~1.5-3s for a full season.
    const ranks = await Promise.all(
      results.map((row) =>
        col.countDocuments({ isoDate: row.isoDate, mvpValue: { $gt: row.mvpValue } }),
      ),
    );

    res.json(results.map((row, i) => ({ ...row, calculatedRank: ranks[i] + 1 })));
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default playersRouter;
