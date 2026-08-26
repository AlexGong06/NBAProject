// The season's shape, and its ranks, without its rows.
//
//   GET /calendar            the 164 dates games were played on
//   GET /calendar/series     every player's rank and value on every date

import { Router } from "express";
import logger from "../../utils/logger";
import { getDb } from "../../database/database";

const calendarRouter = Router();

const COLLECTION = "PlayerDailyValues";

/** Board depth the app requests; the charts never plot deeper than a board. */
const DEFAULT_TOP = 50;

/** "2026-04-12" → "4-12-2026", the key form the front end queries by. */
function toDateKey(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y}`;
}

// The ten days the NBA did not play are the gaps between these dates, and the
// front end derives them rather than being told twice.
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
 * Built once per process, keyed by depth. Assembling it visits all 83,054 rows
 * and costs ~1.5s however it is done; the season is finished, so that is paid
 * once and the first visitor after a restart absorbs it.
 */
const seriesCache = new Map<number, Promise<SeriesPoint[]>>();

/**
 * The only depths that get a cache entry.
 *
 * A miss costs 164 queries and an ~8,000 object array. Keyed straight off the
 * query string, `?top=1,2,3…` is a remote out-of-memory on a small instance.
 */
const SERIES_DEPTHS = new Set([10, 25, 50, 100]);

// One record per player per date. The keys are one letter because at 8,190
// records the key names are a measurable fraction of a payload whose whole
// justification is being small.
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

  // Each query is covered end to end by the { isoDate, mvpValue, player } index
  // — zero documents examined — so the cost is round trips, not reads.
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
    rows.forEach((row: any, n: number) => {
      // Four places, not full float precision: 2.2352279601990053 was most of
      // this response (92 KB gzipped against 63 KB). Rank is decided by the
      // sort above, so rounding cannot reorder anything.
      series.push({ p: row.player, d: dateKey, r: n + 1, v: Math.round(row.mvpValue * 1e4) / 1e4 });
    });
  });

  return series;
}

export default calendarRouter;
