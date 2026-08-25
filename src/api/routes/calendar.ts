// The season's shape, and its ranks, without its rows.
//
//   GET /calendar            the 164 dates games were played on
//   GET /calendar/series     every player's rank and value on every date
//
// ── Why these exist ────────────────────────────────────────────────────────
//
// The app used to open by downloading the whole season — 8,190 rows of 40
// fields, 11.47 MB — because four different things needed it: the date ribbon,
// the charts, the visible board, and player lookup.
//
// Only the third of those needs full rows, and only for one date at a time
// (77 KB). The ribbon needs a list of dates. The charts need four fields per
// point. Splitting them is worth roughly 170x on first load:
//
//   whole season, uncompressed   11.47 MB
//   one date + this series, gzip   0.07 MB
//
// Player lookup already had its own endpoint in /players.

import { Router } from "express";
import logger from "../../utils/logger";
import { getDb } from "../../database/database";

const calendarRouter = Router();

const COLLECTION = "PlayerDailyValues";

/**
 * How deep the series goes.
 *
 * The charts only ever plot players who appear on a board — the sparklines and
 * the bump chart draw the visible top five, and a profile's own rank line comes
 * from the per-player season endpoint, which is unaffected by this. 50 matches
 * the board depth the app requests.
 */
const DEFAULT_TOP = 50;

/** "2026-04-12" → "4-12-2026", the key form the front end queries by. */
function toDateKey(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y}`;
}

// GET /calendar
// The dates the NBA played on. The ten days it did not are the gaps between
// these, and the front end derives them rather than being told twice.
calendarRouter.get("/", async (_req, res) => {
  try {
    const db = await getDb();
    const dates: string[] = await db.collection(COLLECTION).distinct("isoDate");
    dates.sort(); // ISO, so lexicographic is chronological

    if (dates.length === 0) {
      res.status(404).json({ message: "No rankings data available." });
      return;
    }

    res.json({ gameDates: dates });
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

type SeriesPoint = { p: string; d: string; r: number; v: number };

/**
 * Built once per process, keyed by depth.
 *
 * Every way of assembling this costs about 1.5 seconds, because every way has
 * to visit all 83,054 rows once — 164 indexed queries, or a single
 * `$setWindowFields` aggregation, both land in the same place. (The aggregation
 * does work, incidentally, despite the memory warning in CLAUDE.md: projecting
 * down to three fields *before* the window stage keeps it around 3 MB. It is
 * simply no faster, so the established per-date pattern stays.)
 *
 * Since the season is complete and nothing new arrives, that cost is worth
 * paying exactly once. The first visitor after a restart waits; nobody else
 * does. Same reasoning as the last-game index.
 */
const seriesCache = new Map<number, Promise<SeriesPoint[]>>();

/**
 * The only depths that get their own cache entry.
 *
 * The cache is keyed by `?top=`, and a miss costs 164 queries and an ~8,000
 * object array. Keyed straight off the query string, `?top=1,2,3…` is a remote
 * out-of-memory on a small instance. An allowlist bounds the cache at four
 * entries no matter what is asked for.
 */
const SERIES_DEPTHS = new Set([10, 25, 50, 100]);

// GET /calendar/series?top=50
//
// One record per player per date: name, date, rank, value. Nothing else.
//
// The keys are one letter on purpose. At 8,190 records the key names are a
// measurable fraction of the payload, and this is the one response whose whole
// justification is being small — the readable version costs about 40% more for
// data no human reads.
calendarRouter.get("/series", async (req, res) => {
  const raw = Number(req.query.top);
  const top = SERIES_DEPTHS.has(raw) ? raw : DEFAULT_TOP;

  try {
    const cached = seriesCache.get(top);
    if (cached) {
      res.json(await cached);
      return;
    }

    const building = buildSeries(top);
    seriesCache.set(top, building);
    // A failed build must not be cached, or one transient error poisons the
    // endpoint for the life of the process.
    building.catch(() => seriesCache.delete(top));

    res.json(await building);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

async function buildSeries(top: number): Promise<SeriesPoint[]> {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  const dates: string[] = await col.distinct("isoDate");
  dates.sort();

  // One indexed query per date, the same pattern the board uses. Each is
  // covered end to end by the { isoDate, mvpValue, player } index — zero
  // documents examined — so the cost here is round trips, not reads.
  const perDate = await Promise.all(
    dates.map((isoDate) =>
      col
        .find({ isoDate }, { projection: { _id: 0, player: 1, mvpValue: 1 } })
        .sort({ mvpValue: -1 })
        .limit(top)
        .toArray(),
    ),
  );

  const series: SeriesPoint[] = [];
  perDate.forEach((rows, i) => {
    const dateKey = toDateKey(dates[i]);
    // Rank is the position in the sorted result, never a stored field — the
    // same rule every other endpoint follows.
    rows.forEach((row: any, n: number) => {
      // Rounded to four places. The UI never shows more than three (`fmt`),
      // and full float precision — 2.2352279601990053 — was most of this
      // response: 92 KB gzipped against 63 KB rounded, for digits nothing
      // reads. Rank is already decided by the sort above, so rounding cannot
      // reorder anything.
      series.push({ p: row.player, d: dateKey, r: n + 1, v: Math.round(row.mvpValue * 1e4) / 1e4 });
    });
  });

  return series;
}

export default calendarRouter;
