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

/** Neighbours either side of a player for `?around=`, when the caller does not say. */
const DEFAULT_WINDOW = 10;

/** Cap on `?window=`, so one request cannot ask for the whole league by accident. */
const MAX_WINDOW = 50;

function windowParam(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_WINDOW;
  return Math.min(n, MAX_WINDOW);
}

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

/**
 * One date's field around one player.
 *
 * `GET /daily-mvp-rankings/:date?around=Gary%20Payton%20II&window=10`
 *
 * The board endpoints above answer "who leads on this date". This answers
 * "where does *he* sit on this date", which is a different question and cannot
 * be served by cutting a top N: 445 of 582 players never reach a top 50 all
 * season, so for most of the league the board's answer is silence — or worse,
 * the one November date they did crack it, read as their current standing.
 *
 * Note the response is an object, not the array the plain `:date` board returns.
 * A rank is meaningless without the size of the field it was measured in, and
 * the neighbours are only interpretable next to the player's own position, so
 * all three travel together.
 *
 * Ranks are competition ranks — "one more than the number of players strictly
 * ahead" — the same definition used by the per-player season endpoint in
 * players.ts, so the two can never disagree about where somebody stands.
 */
async function fieldAround(db: any, date: string, player: string, window: number) {
  const col = db.collection(COLLECTION);

  const row = await col.findOne({ date, player });
  if (!row) return null;

  // Both counts are answered from the { date: 1, mvpValue: -1 } index without
  // touching a document, and the find below walks that same index from an
  // offset. Nothing is sorted in memory, which is the constraint this whole
  // collection is queried under — see the note on the board endpoint.
  const [better, fieldSize] = await Promise.all([
    col.countDocuments({ date, mvpValue: { $gt: row.mvpValue } }),
    col.countDocuments({ date }),
  ]);

  const rank = better + 1;
  const start = Math.max(0, rank - 1 - window);

  const rows = await col
    .find({ date })
    .sort({ mvpValue: -1 })
    .skip(start)
    .limit(window * 2 + 1)
    .toArray();

  return {
    rank,
    fieldSize,
    complete: true,
    rows: rows.map((r: any, i: number) => ({ ...r, calculatedRank: start + i + 1 })),
  };
}

// GET /daily-mvp-rankings/:date?top=50
// One date's board, best first. Date format is "M-D-YYYY", e.g. "2-17-2026".
//
// With `?around=<player>` this returns that player's neighbourhood instead of
// the leaders — see fieldAround above for the shape and the reasoning.
dailyRankingsRouter.get("/:date", async (req, res) => {
  const date = req.params.date;
  const top = topParam(req.query.top);
  const around = typeof req.query.around === "string" ? req.query.around : null;

  try {
    const db = await getDb();

    if (around) {
      const field = await fieldAround(db, date, around, windowParam(req.query.window));
      if (!field) {
        // No row means he had not played his first game by this date. Every
        // player gets a row on every date from his debut onward, so absence is
        // a real answer, not a gap.
        res.status(404).json({
          message: `No row for ${around} on ${date}. Either the player is unknown or he had not debuted by this date.`,
        });
        return;
      }
      res.json(field);
      return;
    }

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
