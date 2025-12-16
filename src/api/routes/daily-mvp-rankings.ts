import logger from "../../utils/logger";
import { getDb } from "../database";
import { Router } from "express";

const dailyRankingsRouter = Router();

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
dailyRankingsRouter.get("/:date", async (req, res) => {
  const date = req.params.date;

  try {
    const db = await getDb();
    const results = await db
      .collection("DailyMvpRankings")
      .find({ date })
      .toArray();

    res.json(results);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default dailyRankingsRouter;
