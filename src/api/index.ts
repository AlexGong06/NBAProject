import express from "express";
import compression from "compression";
import dailyRankingsRouter from "./routes/daily-mvp-rankings";
import playersRouter from "./routes/players";
import gamesRouter from "./routes/games";
import calendarRouter from "./routes/calendar";
import logger from "../utils/logger";
import { closeDb } from "../database/database";
import cors from "cors";

const PORT = Number(process.env.PORT) || 3000;

// ── Who may call this API ───────────────────────────────────────────────────
//
// `CORS_ORIGIN` is a comma-separated allowlist — in production, the one static
// site that should be calling. Unset means allow any origin, which is what
// local development and the fixture-mode front end need.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use(express.json());
app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          // A request with no Origin header is not a browser cross-origin call
          // — curl, a health check, a server-side fetch. Blocking those breaks
          // uptime monitoring while stopping nothing.
          origin: (origin, cb) =>
            cb(null, !origin || allowedOrigins.includes(origin)),
        }
      : undefined,
  ),
);

// ── Compress everything ─────────────────────────────────────────────────────
//
// These responses are JSON arrays of thousands of objects with identical key
// sets, which is close to the best case for gzip: the season board measured
// 11.47 MB raw and 2.09 MB compressed, and the compact rank series 0.46 MB down
// to 52 KB.
//
// Must be registered before the routes — the middleware wraps `res.write`, so a
// route mounted above it would answer uncompressed.
app.use(compression());

// Let the browser report how big and how slow these responses were.
//
// Resource timings are redacted cross-origin: without this header
// `transferSize` reads 0 and the durations are coarse, so the front end cannot
// measure its own load. The API and the app are on different origins here, and
// will be on a deployed URL too.
app.use((_req, res, next) => {
  res.setHeader("Timing-Allow-Origin", "*");
  next();
});

// Cheap and dependency-free on purpose: this answers "is the process up", not
// "is Mongo reachable". A health check that touches the database turns one slow
// query into a restart loop.
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// register your router
app.use("/daily-mvp-rankings", dailyRankingsRouter);
app.use("/players", playersRouter);
app.use("/games", gamesRouter);
app.use("/calendar", calendarRouter);

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

// ── Shut down when the platform says to ─────────────────────────────────────
//
// Render sends SIGTERM on every deploy and every idle spin-down, then SIGKILLs
// after 30 seconds. Without a handler the process dies mid-request and leaves
// the Mongo connection for the server to time out.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await closeDb().catch(() => {});
      process.exit(0);
    });
    // Don't let a hung connection hold the process past the platform's patience.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

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
