import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { Router } from "express";

const dailyRankingsRouter = Router();

const COLLECTION = "PlayerDailyValues";

/**
 * How many players per date to return when the caller does not say.
 *
 * The collection holds all 582 players on every one of 164 dates — 83,054 rows,
 * far too much to hand over in one response. Storing the whole league is what
 * makes any depth of board possible; bounding it here is what keeps that
 * affordable. 50 per date is ~8,200 rows, comparable to what this endpoint
 * already returned.
 */
const DEFAULT_TOP = 50;

/**
 * Parse `?top=` into a row limit.
 *
 * `?top=all` lifts the cap for the whole-league view. Anything unparseable
 * falls back to the default rather than erroring: a bad query string should
 * give a usable board, not a 400.
 */
function topParam(raw: unknown): number {
  if (raw === "all") return Number.MAX_SAFE_INTEGER;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TOP;
}

/**
 * Ranks are computed on read, never stored.
 *
 * A rank is a property of a date's entire field, not of a player, so storing it
 * would mean rewriting every row on a date whenever any one of them changed —
 * and a board that contradicts itself the moment that half-succeeds. Sorting by
 * `mvpValue` here is also what lets `?top=` mean anything: the depth of the
 * board is a question the caller asks, not one the database answered months ago.
 */

// GET /daily-mvp-rankings?top=50
// The top N players for every date, most recent date first.
//
// Sorting happens in Mongo on `isoDate`, not on `date`. The "M-D-YYYY" key the
// app queries by is unsortable as text — "9-1-2025" sorts above "2-17-2026" —
// so every row carries an ISO twin for exactly this purpose. See date-key.ts.
dailyRankingsRouter.get("/", async (req, res) => {
  const top = topParam(req.query.top);

  try {
    const db = await getDb();
    // One indexed query per date, rather than one aggregation over the season.
    //
    // Both aggregation formulations fail here with code 292,
    // QueryExceededMemoryLimitNoDiskUseAllowed: $group with $push: "$$ROOT"
    // materialises all 83,054 documents, and $setWindowFields has to sort the
    // whole collection to partition it. These rows are wide, and 83,054 of them
    // exceed Mongo's 100 MB limit either way.
    //
    // Each query below is served start-to-finish by the { date: 1, mvpValue: -1 }
    // index — it walks the first `top` entries of one date and stops. Nothing is
    // sorted in memory and nothing is held. It costs 164 small round trips
    // instead of one large one, which is the right trade when the alternative
    // does not run at all.
    const dates: string[] = await db.collection(COLLECTION).distinct("isoDate");
    dates.sort().reverse(); // ISO, so lexicographic is chronological

    const perDate = await Promise.all(
      dates.map((isoDate) =>
        db
          .collection(COLLECTION)
          .find({ isoDate })
          .sort({ mvpValue: -1 })
          .limit(top === Number.MAX_SAFE_INTEGER ? 0 : top)
          .toArray(),
      ),
    );

    const rows = perDate.flat();

    res.json(rows);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

// GET /daily-mvp-rankings/:date?top=50
// One date's board, best first. Date format is "M-D-YYYY", e.g. "2-17-2026".
dailyRankingsRouter.get("/:date", async (req, res) => {
  const date = req.params.date;
  const top = topParam(req.query.top);

  try {
    const db = await getDb();
    const results = await db
      .collection(COLLECTION)
      .find({ date })
      .sort({ mvpValue: -1 })
      .limit(top === Number.MAX_SAFE_INTEGER ? 0 : top)
      .toArray();

    // An empty result means the NBA played no regular-season games that day —
    // Thanksgiving, Christmas Eve, the All-Star break, the NBA Cup final. Say so
    // rather than returning an ambiguous empty array.
    if (results.length === 0) {
      res.status(404).json({
        message: `No rankings for ${date}. No regular-season games were played on this date.`,
      });
      return;
    }

    res.json(results);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default dailyRankingsRouter;
