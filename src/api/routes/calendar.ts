// The season's shape, and its ranks, without its rows.
//
//   GET /calendar?season=            the dates games were played on
//   GET /calendar/series?season=     every player's rank and value on every date
//
// Both take `?season=` and default to the current one. See src/utils/season.ts.

import { Router } from "express";
import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { seasonScope } from "../season-scope";
import { seasonCache } from "../season-cache";

const calendarRouter = Router();

const COLLECTION = "PlayerDailyValues";

/** Board depth the app requests; the charts never plot deeper than a board. */
const DEFAULT_TOP = 50;

/**
 * A fingerprint of one season's stored rows, for both caches below.
 *
 * The row count alone would miss nothing that this API can currently produce —
 * `build-season --apply` only ever adds dates — but the newest date is carried
 * too, because it is the value both of these caches are actually shaped by and
 * one extra indexed lookup is free. Both reads are served by the
 * `{ season, isoDate, mvpValue }` index without touching a document.
 */
export async function dailyValuesVersion(season: string): Promise<string> {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  const [rows, newest] = await Promise.all([
    col.countDocuments({ season }),
    col
      .find({ season }, { projection: { _id: 0, isoDate: 1 } })
      .sort({ isoDate: -1 })
      .limit(1)
      .next(),
  ]);

  return `${rows}:${newest?.isoDate ?? ""}`;
}

/**
 * The dates a season was played on.
 *
 * Cached because the front end asks for this first, on every load, and a
 * `distinct` over 83,054 rows measured 0.28s — which is 0.28s in front of the
 * first paint, every time, for an answer that changes once a night.
 */
const gameDatesCache = seasonCache<string[]>({
  label: "calendar",
  version: dailyValuesVersion,
  build: async (season) => {
    const db = await getDb();
    const dates: string[] = await db
      .collection(COLLECTION)
      .distinct("isoDate", { season });
    dates.sort(); // ISO, so lexicographic is chronological
    return dates;
  },
});

/** "2026-04-12" → "4-12-2026", the key form the front end queries by. */
function toDateKey(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y}`;
}

// The days the NBA did not play are the gaps between these dates, and the front
// end derives them rather than being told twice. Ten of them in 2025-26; a
// season still in progress simply has fewer dates, and its last date is the
// most recent night that has been ingested.
calendarRouter.get("/", async (req, res) => {
  const { season, error, status } = await seasonScope(req.query.season);
  if (error) {
    res.status(status).json({ message: error });
    return;
  }

  try {
    const dates = await gameDatesCache.get(season);

    if (dates.length === 0) {
      res.status(404).json({ message: `No rankings data for ${season}.` });
      return;
    }

    // The season rides along so the front end never has to assume which season
    // it asked for — it builds its whole calendar from this response.
    res.json({ season, gameDates: dates });
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

type SeriesPoint = { p: string; d: string; r: number; v: number };

/**
 * Keyed by `season:depth`.
 *
 * Assembling one costs 2.3-6.4s however it is done (measured), and whoever asks
 * first absorbs it — which is why the server warms this at startup rather than
 * leaving it to a visitor. Keyed by season as well as depth because the two
 * seasons are different series; a depth-only key would serve whichever season
 * warmed the entry first.
 *
 * A season label contains no colon, so the season is always the part before the
 * first one.
 */
const seriesCache = seasonCache<SeriesPoint[]>({
  label: "calendar/series",
  version: (key) => dailyValuesVersion(key.split(":")[0]),
  build: (key) => {
    const [season, top] = key.split(":");
    return buildSeries(season, Number(top));
  },
});

/** Build one season's series at the depth the app asks for, up front. */
export async function warmCalendar(season: string): Promise<void> {
  await Promise.all([
    gameDatesCache.warm(season),
    seriesCache.warm(`${season}:${DEFAULT_TOP}`),
  ]);
}

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

  const { season, error, status } = await seasonScope(req.query.season);
  if (error) {
    res.status(status).json({ message: error });
    return;
  }
  try {
    res.json(await seriesCache.get(`${season}:${top}`));
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

async function buildSeries(season: string, top: number): Promise<SeriesPoint[]> {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  const dates: string[] = await col.distinct("isoDate", { season });
  dates.sort();

  // Each query is covered end to end by the { isoDate, mvpValue, player } index
  // — zero documents examined — so the cost is round trips, not reads.
  const perDate = await Promise.all(
    dates.map((isoDate) =>
      col
        .find({ season, isoDate }, { projection: { _id: 0, player: 1, mvpValue: 1 } })
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
