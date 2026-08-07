import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { Router } from "express";
import { byDateKeyDescending } from "../../utils/date-key";

const dailyRankingsRouter = Router();

// GET /daily-mvp-rankings
// Returns every player record across all dates, sorted by date descending.
// The frontend filters this down to just the most recent date on the client side.
//
// The sort happens here rather than in Mongo. Dates are stored as "M-D-YYYY"
// strings, and a database sort on that compares them as text: "9-1-2025" lands
// above "2-17-2026", which lands above "12-1-2026". byDateKeyDescending parses
// before comparing. See src/utils/date-key.test.ts.
dailyRankingsRouter.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.collection("DailyMvpRankings").find({}).toArray();

    const results = byDateKeyDescending(rows);

    res.json(results);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

// GET /daily-mvp-rankings/:date
// Returns all player records for a specific date (format: "M-D-YYYY", e.g. "2-17-2026").
// Returns 404 with a descriptive message if no data exists for that date —
// this happens when the scraper didn't run that day (holidays, failures, etc.)
dailyRankingsRouter.get("/:date", async (req, res) => {
  const date = req.params.date;

  try {
    const db = await getDb();
    const results = await db
      .collection("DailyMvpRankings")
      .find({ date })
      .toArray();

    // If the array is empty, no scrape ran on this date — tell the client clearly
    // rather than returning an ambiguous empty array.
    if (results.length === 0) {
      res.status(404).json({
        message: `No rankings data available for ${date}. The scraper may not have run on this day.`,
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
