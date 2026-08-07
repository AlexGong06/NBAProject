import { pino } from "pino";

// LOG_LEVEL lets the test run set "silent" — the scoring function logs once per
// player, which otherwise buries the test output.
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

export default logger;
