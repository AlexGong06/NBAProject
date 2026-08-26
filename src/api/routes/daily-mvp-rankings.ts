import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { lastGameFor, lastGameIndex } from "./last-game-index";
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
 * Hard cap on `?top=`.
 *
 * `?top=all` used to mean `MAX_SAFE_INTEGER`, which reaches Mongo as `limit(0)`
 * — every row, ~11.5 MB serialized and copied again in heap by the mapping
 * pass. One request, from anyone, on a public URL.
 */
const MAX_TOP = 100;

/**
 * Parse `?top=` into a row limit.
 *
 * Anything unparseable falls back to the default rather than erroring: a bad
 * query string should give a usable board, not a 400.
 */
function topParam(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_TOP;
  return Math.min(n, MAX_TOP);
}

// GET /daily-mvp-rankings?top=50 — the top N for every date, newest first.
//
// Rank is computed here and never stored: it is a property of a date's whole
// field, so storing it would mean rewriting every row on a date whenever one
// changed. Sorting by `mvpValue` on read is also what lets `?top=` mean
// anything.
//
// Sorting happens on `isoDate`, not `date`. The "M-D-YYYY" key the app queries
// by is unsortable as text — "9-1-2025" sorts above "2-17-2026" — so every row
// carries an ISO twin. See date-key.ts.
dailyRankingsRouter.get("/", async (req, res) => {
  const top = topParam(req.query.top);

  try {
    const db = await getDb();
    // One indexed query per date, not one aggregation over the season. Both
    // aggregation formulations fail with code 292: `$group`/`$push: "$$ROOT"`
    // materialises all 83,054 wide documents and `$setWindowFields` sorts the
    // whole collection, and either exceeds Mongo's 100 MB limit.
    //
    // Each query here is served start-to-finish by { date: 1, mvpValue: -1 } —
    // it walks the first `top` entries of one date and stops.
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

    // Each row carries the player's last game *as of that row's date*, so the
    // board can draw a chip per row without a request per row. Attached here
    // rather than fetched by the client for the same reason the rank is: it is
    // a property of a player on a date, and the date is already known.
    const index = await lastGameIndex();
    const rows = perDate
      .flat()
      .map((r: any) => ({ ...r, lastGame: lastGameFor(index, r.playerId, r.isoDate) }));

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
 * The board answers "who leads on this date"; this answers "where does *he*
 * sit", which cutting a top N cannot serve — 445 of 582 players never reach a
 * top 50 all season.
 *
 * The response is an object, not an array: a rank is meaningless without the
 * size of the field it was measured in, so the three travel together.
 *
 * Ranks are competition ranks — one more than the number strictly ahead — the
 * same definition players.ts uses, so the two cannot disagree.
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

  const index = await lastGameIndex();

  return {
    rank,
    fieldSize,
    complete: true,
    rows: rows.map((r: any, i: number) => ({
      ...r,
      calculatedRank: start + i + 1,
      lastGame: lastGameFor(index, r.playerId, r.isoDate),
    })),
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

    const index = await lastGameIndex();
    res.json(
      results.map((r: any) => ({ ...r, lastGame: lastGameFor(index, r.playerId, r.isoDate) })),
    );
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default dailyRankingsRouter;
