import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { Router } from "express";
import { byDateKeyDescending } from "../../utils/date-key";

const playersRouter = Router();

// GET /api/players/:playerName/daily-mvp-rankings
playersRouter.get("/:playerName/daily-mvp-rankings", async (req, res) => {
  const playerName = req.params.playerName;

  try {
    const db = await getDb();
    const rows = await db
      .collection("DailyMvpRankings")
      .find({ player: playerName })
      .toArray();

    // Sorted here rather than in Mongo. Dates are "M-D-YYYY" strings, which a
    // database sort compares as text — "9-30-2025" would land above
    // "2-17-2026". This endpoint feeds the profile chart, so a text sort draws
    // the player's season in the wrong order. See src/utils/date-key.test.ts.
    const results = byDateKeyDescending(rows);

    res.json(results);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default playersRouter;
