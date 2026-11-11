// Which seasons this deployment can actually serve.
//
//   GET /seasons
//
// `SEASONS` in src/utils/season.ts is what the code knows how to serve; this is
// what the database can answer. The two differ exactly when a season has been
// added but not yet built, which is the normal state on the first day of a new
// season — so the list is filtered against the data rather than returned as
// declared. A dropdown offering a season with no rows behind it is a dead
// option that looks like a broken app.
//
// Each entry carries the season's extent, so the front end can label a
// dropdown ("2026-27 · through Nov 9") without a second request per season.

import { Router } from "express";
import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { CURRENT_SEASON, SEASONS } from "../../utils/season";
import { defaultSeason } from "../season-scope";

const seasonsRouter = Router();

const COLLECTION = "PlayerDailyValues";

export type SeasonSummary = {
  season: string;
  /** Game days ingested so far — not the length of the schedule. */
  gameDays: number;
  firstDate: string;
  lastDate: string;
  /** The season the API serves when no `?season=` is given. */
  current: boolean;
};

seasonsRouter.get("/", async (_req, res) => {
  try {
    const db = await getDb();
    const col = db.collection(COLLECTION);

    // One `distinct` per season, each served by the season-leading index. Two
    // round trips today; a route that scanned for the seasons present instead
    // would be an aggregation over 83,054 rows to learn two strings.
    const summaries = await Promise.all(
      SEASONS.map(async (season): Promise<SeasonSummary | null> => {
        const dates: string[] = await col.distinct("isoDate", { season });
        if (dates.length === 0) return null;
        dates.sort(); // ISO, so lexicographic is chronological
        return {
          season,
          gameDays: dates.length,
          firstDate: dates[0],
          lastDate: dates[dates.length - 1],
          current: season === CURRENT_SEASON,
        };
      }),
    );

    const available = summaries.filter((s): s is SeasonSummary => s !== null);

    if (available.length === 0) {
      res.status(404).json({
        message:
          `None of the seasons this app knows about (${SEASONS.join(", ")}) ` +
          `have rows in ${COLLECTION}. Run \`pnpm build-season --apply\`.`,
      });
      return;
    }

    // `current` is the configured season; `defaultSeason` is the one the other
    // routes actually serve when no `?season=` is given. They differ on the
    // first night of a new season, before it has been built — and the dropdown
    // has to open on the second, or it opens on an empty board. Resolved by the
    // same function the routes use, so the two cannot drift.
    res.json({ seasons: available, defaultSeason: await defaultSeason() });
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default seasonsRouter;
