import express from "express";
import dailyRankingsRouter from "./routes/daily-mvp-rankings";
import playersRouter from "./routes/players";
import logger from "../utils/logger";

const app = express();
logger.info("running server");
app.use(express.json());

// register your router
app.use("/daily-mvp-rankings", dailyRankingsRouter);
app.use("/players", playersRouter);

app.listen(3000, () => {
  logger.info("Server running on port 3000");
});
