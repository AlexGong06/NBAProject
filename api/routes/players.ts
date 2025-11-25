import { getDb } from "../database";
import { Router } from "express";

const router = Router();

router.get("/daily-rankings", async (req, res) => {
  try {
    const db = await getDb();
    const results = await db
      .collection("DailyMvpRankings")
      .find({})
      .sort({ date: -1 })
      .toArray();

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

export default router;
