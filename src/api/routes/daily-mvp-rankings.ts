import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { Router } from "express";

const dailyRankingsRouter = Router();

// GET /daily-mvp-rankings
// Returns every player record across all dates, sorted by date descending.
// The frontend filters this down to just the most recent date on the client side.
dailyRankingsRouter.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const results = await db
      .collection("DailyMvpRankings")
      .find({})
      .sort({ date: -1 })
      .toArray();

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
