import { pino } from "pino";

// LOG_LEVEL lets the test run set "silent" — the scoring function logs once per
// player, which otherwise buries the test output.
// pino-pretty is a development convenience. In production it costs a worker
// thread and emits ANSI colour codes into a log viewer that wants raw JSON —
// which is also the format that makes the lines searchable.
const pretty = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(pretty
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

export default logger;
