// Resolves `?season=` for a route, against what the database actually holds.
//
// ── Why this is not just `resolveSeasonParam` ──────────────────────────────
//
// `SEASONS` is what the code knows how to serve. It gains an entry the moment a
// new season is added, which is necessarily BEFORE that season has been built —
// `pnpm build-season --apply` cannot run against a season the code does not
// name. So there is always a window, at the start of every season, where the
// configured current season has no rows.
//
// Defaulting to it during that window makes every request without an explicit
// `?season=` answer 404, including the front end's opening four. The app would
// go dark on the day a season was added, and the cause — a constant in a file
// nobody touched that day — is nowhere in the response.
//
// So an absent parameter means "the newest season with data", and an explicit
// one is honoured exactly as asked: a request for a declared-but-unbuilt season
// gets that season's own empty answer, which is true, rather than a different
// season's rows.

import { getDb } from "../database/database";
import { CURRENT_SEASON, SEASONS, resolveSeasonParam } from "../utils/season";

const COLLECTION = "PlayerDailyValues";

/**
 * How long a resolved default is trusted.
 *
 * The answer changes exactly once per season — on the night the new season is
 * first built — and a process that cached it forever would serve the previous
 * season until it was restarted. One `distinct` a minute against an index that
 * leads with `season` is not a cost worth optimising away.
 */
const TTL_MS = 60_000;

let cached: { season: string | null; at: number } | null = null;

/**
 * Which seasons have rows, newest first, in `SEASONS` order.
 *
 * Ordered by the declared list rather than by sorting the strings, so "newest"
 * stays one definition — see the note on `SEASONS`.
 */
async function seasonsWithData(): Promise<string[]> {
  const db = await getDb();
  const present: string[] = await db.collection(COLLECTION).distinct("season");
  const have = new Set(present);
  return SEASONS.filter((s) => have.has(s));
}

/**
 * The season to serve when the caller did not name one: the configured current
 * season if it has rows, otherwise the newest that does. Null when nothing has
 * been built at all.
 */
export async function defaultSeason(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.season;

  const available = await seasonsWithData();
  const season = available.includes(CURRENT_SEASON)
    ? CURRENT_SEASON
    : available[0] ?? null;

  cached = { season, at: Date.now() };
  return season;
}

/** Drop the memoised default. For tests, and for a cache-bust endpoint. */
export function resetDefaultSeason(): void {
  cached = null;
}

export type SeasonScope =
  | { season: string; error?: undefined; status?: undefined }
  | { season?: undefined; error: string; status: number };

/**
 * Resolve a route's season.
 *
 * An explicit `?season=` is validated against `SEASONS` and passed through — a
 * 400 when unknown, never a silent substitution. An absent one resolves against
 * the data, and 503s when the database holds no season at all: that is a
 * deployment that has not been built yet, not a bad request.
 */
export async function seasonScope(raw: unknown): Promise<SeasonScope> {
  if (raw !== undefined && raw !== null && raw !== "") {
    const resolved = resolveSeasonParam(raw);
    return resolved.error
      ? { error: resolved.error, status: 400 }
      : { season: resolved.season as string };
  }

  const season = await defaultSeason();
  if (!season) {
    return {
      status: 503,
      error:
        `No season has been built. This deployment serves ` +
        `${SEASONS.join(", ")}, and ${COLLECTION} holds rows for none of ` +
        `them. Run \`pnpm build-season --apply\`.`,
    };
  }
  return { season };
}
