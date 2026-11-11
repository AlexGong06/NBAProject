// Seasons.
//
// A season label is the form the NBA's own API takes: "2025-26", "2026-27" —
// four digits, a hyphen, then the last two of the following year. It is passed
// straight to `stats.nba.com` as the `Season` parameter, so it is a contract
// with an external service, not a display string.
//
// ── Why the list is explicit ────────────────────────────────────────────────
//
// `SEASONS` is hand-maintained rather than discovered from the database. A new
// season is not just more rows: it needs its own raw collections and its own
// YouTube highlights playlist, both of which are decisions a human makes. A
// list that grew by itself would let a typo in a query string mint an empty
// season nobody meant to create.
//
// ── Where the raw collections come from ─────────────────────────────────────
//
// `PlayerGameLogs2526` and `GameSummaries2526` were named for the one season
// that existed. The suffix is now derived from the label, so 2026-27 writes to
// `PlayerGameLogs2627` without renaming or migrating anything. Partitioning the
// raw fact per season is also what keeps the API's in-process indexes the size
// of one season rather than of the archive.
//
// `PlayerDailyValues` stays a single collection, carrying a `season` field.
// Its rows are read one date at a time through an index, so they do not need
// physical separation — and a `season` field is what lets one query answer
// "every season this app knows about".

/**
 * Every season this app serves, newest first.
 *
 * Add a new one at the FRONT: `SEASONS[0]` is what the API and the scripts
 * default to, and what the front end opens on.
 */
export const SEASONS = ["2026-27", "2025-26"] as const;

export type SeasonLabel = (typeof SEASONS)[number];

/** Well-formed label naming consecutive years — "2025-26", not "2025-27". */
const SEASON_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * True when `label` is a syntactically valid season label.
 *
 * Checks that the two halves name consecutive years, which is what catches the
 * plausible typo: "2025-27" is the right shape and the wrong season, and the
 * NBA API answers it with an empty result set rather than an error.
 */
export function isSeasonLabel(label: string): boolean {
  const match = SEASON_PATTERN.exec(label);
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return (start + 1) % 100 === end;
}

/** True when this app has collections and a playlist for `label`. */
export function isKnownSeason(label: string): label is SeasonLabel {
  return (SEASONS as readonly string[]).includes(label);
}

/**
 * The season the scripts and the API default to.
 *
 * `NBA_SEASON_LABEL` overrides it, which is how a one-off rebuild of an older
 * season is run. An unparseable value throws rather than falling back: a typo
 * in the variable that decides which season gets written is not something to
 * paper over.
 *
 * Not to be confused with `NBA_SEASON` (a year, "2026"), which only the legacy
 * Basketball Reference scripts read.
 */
export const CURRENT_SEASON: string = (() => {
  const override = process.env.NBA_SEASON_LABEL;
  if (!override) return SEASONS[0];
  if (!isSeasonLabel(override)) {
    throw new Error(
      `NBA_SEASON_LABEL is "${override}", which is not a season label. ` +
        `Expected the NBA API's form — two consecutive years, e.g. "2026-27".`,
    );
  }
  return override;
})();

/** "2025-26" → "2526", the suffix the per-season collections are named with. */
export function seasonSuffix(season: string): string {
  const match = SEASON_PATTERN.exec(season);
  if (!match) {
    throw new Error(
      `Cannot derive a collection suffix from "${season}" — expected a season ` +
        `label like "2026-27".`,
    );
  }
  return `${match[1].slice(2)}${match[2]}`;
}

/**
 * The raw collections holding one season's facts.
 *
 * `PlayerDailyValues` and `PlayerGameHighlights` are deliberately absent: both
 * are shared across seasons — the first keyed by a `season` field, the second
 * by a game id, which the NBA already namespaces per season (`0022500001` for
 * 2025-26, `0022600001` for 2026-27).
 */
export function seasonCollections(season: string): {
  logs: string;
  summaries: string;
} {
  const suffix = seasonSuffix(season);
  return {
    logs: `PlayerGameLogs${suffix}`,
    summaries: `GameSummaries${suffix}`,
  };
}

/**
 * Read a `?season=` query parameter.
 *
 * An absent parameter means the current season — every route has to answer
 * something, and the newest season is what the app opens on. An unknown one is
 * an error rather than a silent fallback: a stale link asking for a season this
 * deployment does not serve should say so, not quietly hand back a different
 * season's board under the requested season's name.
 */
export function resolveSeasonParam(raw: unknown):
  | { season: string; error?: undefined }
  | { season?: undefined; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { season: CURRENT_SEASON };
  }
  if (typeof raw !== "string" || !isKnownSeason(raw)) {
    return {
      error:
        `Unknown season "${String(raw)}". This deployment serves ` +
        `${SEASONS.join(", ")}.`,
    };
  }
  return { season: raw };
}
