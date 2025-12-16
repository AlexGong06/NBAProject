import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { Router } from "express";

const playersRouter = Router();

// GET /api/players/:playerName/daily-mvp-rankings
playersRouter.get("/:playerName/daily-mvp-rankings", async (req, res) => {
  const playerName = req.params.playerName;

  try {
    const db = await getDb();
    const results = await db
      .collection("DailyMvpRankings")
      .find({ player: playerName })
      .sort({ date: -1 })
      .toArray();

    res.json(results);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default playersRouter;
