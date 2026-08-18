import express from "express";
import dailyRankingsRouter from "./routes/daily-mvp-rankings";
import playersRouter from "./routes/players";
import logger from "../utils/logger";
import cors from "cors";

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());
app.use(cors());

// register your router
app.use("/daily-mvp-rankings", dailyRankingsRouter);
app.use("/players", playersRouter);

const server = app.listen(PORT);

// ── Only claim to be running if the socket is actually bound ────────────────
//
// `app.listen(port, callback)` cannot be trusted to mean success. On Node 26
// the callback fires even when the bind failed: `server.address()` comes back
// null and the EADDRINUSE error arrives afterwards. A server started while
// another already holds the port therefore printed "Server running on port
// 3000" and exited, handing back a shell prompt with no error and no server —
// and no hint that the port was the problem.
//
// So success is reported from the "listening" event and confirmed against the
// real address, and failure is stated in terms of what to do about it.
server.on("listening", () => {
  const address = server.address();
  if (!address) {
    logger.error(`Port ${PORT} reported listening but is not bound. Not serving.`);
    process.exit(1);
  }
  logger.info(`Server running on port ${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      `Port ${PORT} is already in use — another server is running. ` +
        `Find it with \`lsof -nP -iTCP:${PORT} -sTCP:LISTEN\` and stop it, ` +
        `or start this one on a different port with \`PORT=3001 pnpm start-server\`.`,
    );
  } else {
    logger.error(err);
  }
  process.exit(1);
});
