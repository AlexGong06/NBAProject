// Build the expensive caches at startup, so a visitor never pays for them.
//
// ── Why ───────────────────────────────────────────────────────────────────────
//
// `/calendar/series` costs 6.4s cold and 0.001s warm (measured, 2026-27), and
// it is one of the four requests the front end makes before it can draw
// anything. The last-game index costs another 3.0s. Left to itself, whoever
// loads the site first after a deploy waits out both — and on a deployment whose
// whole point is that the first visitor is someone being shown the project, that
// is the one request that must not be slow.
//
// So the server does it to itself instead, in the background, immediately after
// the socket is bound. Nothing here is on the request path:
//
//   * it runs after `listen`, so the health check passes while warming;
//   * it never throws into the process — a failure means the first request
//     builds the cache the old way, which is the behaviour this replaces;
//   * the default season is warmed first and fully, because that is what a
//     visitor lands on, and the others follow one at a time so a cold start
//     does not open 184 concurrent queries per season against Atlas.
//
// This is startup work, not a keep-alive. The caches notice new data on their
// own — see src/api/season-cache.ts.

import logger from "../utils/logger";
import { defaultSeason, seasonsWithData } from "./season-scope";
import { warmCalendar } from "./routes/calendar";
import { warmLastGameIndex } from "./routes/last-game-index";

async function warmSeason(season: string): Promise<void> {
  const started = Date.now();
  await Promise.all([warmCalendar(season), warmLastGameIndex(season)]);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  logger.info(`warm: ${season} ready in ${secs}s`);
}

/**
 * Warm every season that has data, the default one first.
 *
 * Resolves when all of them are warm. Callers that do not want to wait should
 * not await it — the server does not.
 */
export async function warmSeasonCaches(): Promise<void> {
  try {
    const primary = await defaultSeason();
    if (!primary) {
      // Not an error: a deployment that has not been built yet. `seasonScope`
      // already explains this on the request path with a 503.
      logger.warn("warm: no season has been built, nothing to warm");
      return;
    }

    await warmSeason(primary);

    // The rest matter because the season picker offers them. A visitor who
    // switches season should not be the one who discovers it was cold.
    const rest = (await seasonsWithData()).filter((s) => s !== primary);
    for (const season of rest) {
      await warmSeason(season).catch((err) =>
        logger.error({ err }, `warm: ${season} failed, it will build on demand`),
      );
    }
  } catch (err) {
    logger.error({ err }, "warm: failed, caches will build on demand");
  }
}
