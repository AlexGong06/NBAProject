// Turns a flat list of stored ranking rows into the shape the UI reads.
//
// This is the whole of the front end's data layer. Both sources — the bundled
// fixture and the live API — produce the same array of rows and hand it here,
// so there is exactly one implementation of grouping, gap detection, ranking
// and history.
//
// Nothing in this file computes a score. Every number the UI shows was
// calculated once, by the backend, at scrape time, and stored. That is
// deliberate: the app used to re-run the MVP formula in the browser to recover
// intermediate terms the database had thrown away, which gave one calculation
// two implementations that could disagree — and they did.

import { TEAMS } from "./teams";
import type {
  DataSource, DateInfo, Game, HistoryPoint, PlayerSeason, RankedPlayer,
  RosterEntry, Snapshot, StoredRow,
} from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Terms every row must carry, since the UI can no longer derive them. */
const REQUIRED_TERMS = [
  "mvpValue", "rawValue", "availability", "winContribution", "totalStats",
  "levelOfImpact", "qualityOfImpact", "teamWinRatio", "minutesFactor", "usageFactor",
] as const;

/** "2-17-2026" → DateInfo */
function toDateInfo(dateKey: string): DateInfo {
  const [m, d, y] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    key: dateKey,
    short: `${MONTHS[dt.getMonth()]} ${dt.getDate()}`,
    iso: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
    long: `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`,
    weekday: WEEKDAYS[dt.getDay()],
  };
}

/**
 * Sortable timestamp for an "M-D-YYYY" key.
 *
 * These keys cannot be compared as text — "9-30-2025" sorts above "2-17-2026",
 * which is why anything ordering by date has to parse first.
 */
function sortKey(dateKey: string): number {
  const [m, d, y] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Fail loudly on rows that predate the stored breakdown.
 *
 * Rendering them would show blanks and NaNs scattered through a board that
 * otherwise looks fine — the exact silent-wrongness this project exists to
 * avoid. Better to refuse and say why.
 */
function assertRowsAreComplete(rows: StoredRow[], source: string): void {
  const row = rows[0] as unknown as Record<string, unknown>;
  const missing = REQUIRED_TERMS.filter((k) => typeof row[k] !== "number");
  if (missing.length === 0) return;

  throw new Error(
    `${source} returned rows without the stored score breakdown ` +
      `(missing: ${missing.join(", ")}). These rows predate formula version 2 ` +
      `and the front end no longer recalculates. Run the migration to backfill ` +
      `them, or use the bundled fixture instead.`,
  );
}

/**
 * Optional capabilities a source can supply beyond the rows themselves.
 *
 * The board is always a top N per date, so most of the league is absent from
 * `rows` — 137 of 582 players reach a top 50 all season. A source that can
 * reach further (the API) passes these in; the offline fixture cannot, and
 * says so by omitting them.
 */
export type SourceExtras = {
  /** Every player in the league, for search. Ordered best first. */
  roster?: RosterEntry[];
  /**
   * Fetch one player's full season, ranks included. Resolves null when the
   * player is unknown to the source.
   */
  fetchPlayerSeason?: (playerName: string) => Promise<RankedPlayer[] | null>;
};

export function buildDataSource(
  rows: StoredRow[],
  source: string,
  extras: SourceExtras = {},
): DataSource {
  if (!rows.length) throw new Error(`${source} returned no ranking rows`);
  assertRowsAreComplete(rows, source);

  const byDate = new Map<string, StoredRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  const present = [...byDate.keys()].sort((a, b) => sortKey(a) - sortKey(b));

  // Every calendar day between the first and last observation, so a day the
  // collector missed stays visible as a gap instead of vanishing from the
  // timeline. A missing day is not a day without candidates.
  const DATES: DateInfo[] = [];
  const first = new Date(sortKey(present[0]));
  const last = new Date(sortKey(present[present.length - 1]));
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    DATES.push(toDateInfo(`${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`));
  }

  const MISSING = new Set(DATES.filter((d) => !byDate.has(d.key)).map((d) => d.key));
  const TODAY_KEY = DATES[DATES.length - 1].key;

  const SNAPSHOTS: Snapshot[] = DATES.map((date) => {
    const dayRows = byDate.get(date.key);
    if (!dayRows) return { date, missing: true, rows: [] };

    // Ordered by the stored score, and the rank is the resulting position —
    // never a rank that arrived on the row. A stored rank beside a score from a
    // different formula run is how a board ends up disagreeing with itself.
    const ordered = [...dayRows]
      .sort((a, b) => b.mvpValue - a.mvpValue)
      .map((r, n) => ({ ...r, calculatedRank: n + 1, date: date.key, delta: 0 }));

    return { date, missing: false, rows: ordered };
  });

  const dateIndex = (dateKey: string) => DATES.findIndex((d) => d.key === dateKey);
  const snapshot = (dateKey: string) =>
    SNAPSHOTS.find((s) => s.date.key === dateKey) ?? null;

  const previousWithData = (dateKey: string): Snapshot | null => {
    for (let i = dateIndex(dateKey) - 1; i >= 0; i--) {
      if (!SNAPSHOTS[i].missing) return SNAPSHOTS[i];
    }
    return null;
  };

  const nearestWithData = (dateKey: string, count: number): DateInfo[] => {
    const idx = dateIndex(dateKey);
    const out: DateInfo[] = [];
    for (let r = 1; r < DATES.length && out.length < count; r++) {
      [idx - r, idx + r].forEach((j) => {
        if (out.length < count && j >= 0 && j < DATES.length && !SNAPSHOTS[j].missing) {
          out.push(SNAPSHOTS[j].date);
        }
      });
    }
    return out;
  };

  /** Rankings for a date, with movement measured against the last day that has data. */
  const rankings = (dateKey: string): RankedPlayer[] | null => {
    const snap = snapshot(dateKey);
    if (!snap || snap.missing) return null;
    const prev = previousWithData(dateKey);
    return snap.rows.map((r) => {
      const before = prev ? prev.rows.find((x) => x.player === r.player) : null;
      return { ...r, delta: before ? before.calculatedRank - r.calculatedRank : 0 };
    });
  };

  /**
   * Seasons fetched on demand for players the board never loaded.
   *
   * Declared before `history` because `history` consults it. Putting the cache
   * here — rather than handing fetched points to the profile component — is
   * what lets the charts, the peak-rank readout and anything added later work
   * for these players without knowing they were fetched at all.
   */
  const seasonCache = new Map<string, PlayerSeason | null>();

  const history = (playerName: string, dateKey: string, days: number): HistoryPoint[] => {
    const end = dateIndex(dateKey);
    const start = Math.max(0, end - days + 1);

    // A fetched season is already aligned to DATES, so the same window applies.
    const fetched = seasonCache.get(playerName);
    if (fetched && !SNAPSHOTS.some((s) => s.rows.some((r) => r.player === playerName))) {
      return fetched.history.slice(start, end + 1);
    }

    return SNAPSHOTS.slice(start, end + 1).map((s) => {
      const row = s.missing ? null : s.rows.find((r) => r.player === playerName);
      return {
        date: s.date,
        missing: s.missing,
        rank: row ? row.calculatedRank : null,
        score: row ? row.mvpValue : null,
      };
    });
  };

  // Each player's most recent row, current leader first, every entry carrying a
  // full breakdown so the UI never has to look one up.
  //
  // The latest day is taken from rankings() so those entries carry real
  // movement; anyone who has dropped out of the tracked set since then is
  // appended with a zero delta, because there is nothing to compare against.
  const latest = new Map<string, RankedPlayer>();
  for (const r of rankings(TODAY_KEY) ?? []) latest.set(r.player, r);
  for (let i = SNAPSHOTS.length - 1; i >= 0; i--) {
    for (const r of SNAPSHOTS[i].rows) {
      if (!latest.has(r.player)) latest.set(r.player, { ...r, delta: 0 });
    }
  }
  const PLAYERS = [...latest.values()].sort((a, b) => b.mvpValue - a.mvpValue);

  // There is no schedule endpoint and no schedule in the stored rows, so the
  // upcoming-games section stays empty rather than being invented.
  const nextGames = (): Game[] => [];

  const findPlayer = (name: string) => PLAYERS.find((p) => p.player === name);

  // ── Search index ─────────────────────────────────────────────────────────
  //
  // The supplied roster covers the whole league; the loaded board covers a top
  // N. Anyone in the board is marked `loaded` so the UI knows their profile
  // needs no fetch. Falling back to the loaded players alone is what the
  // offline fixture gets — a smaller search, but an honest one.
  const ROSTER: RosterEntry[] = extras.roster
    ? extras.roster.map((entry) => ({ ...entry, loaded: !!findPlayer(entry.player) }))
    : PLAYERS.map((p) => ({
        player: p.player,
        team: p.team,
        pos: p.pos,
        pointsPerGame: p.pointsPerGame,
        mvpValue: p.mvpValue,
        loaded: true,
      }));

  const loadPlayerSeason = async (playerName: string): Promise<PlayerSeason | null> => {
    // Already in the board — answer from memory, no request.
    const local = findPlayer(playerName);
    if (local) {
      return {
        current: local,
        history: history(playerName, TODAY_KEY, DATES.length),
      };
    }

    if (seasonCache.has(playerName)) return seasonCache.get(playerName) ?? null;
    if (!extras.fetchPlayerSeason) {
      seasonCache.set(playerName, null);
      return null;
    }

    const fetched = await extras.fetchPlayerSeason(playerName);
    if (!fetched || fetched.length === 0) {
      seasonCache.set(playerName, null);
      return null;
    }

    // Index the fetched rows by date so history lines up with the calendar the
    // rest of the app already built. Dates the player has no row for stay
    // missing rather than being drawn as a drop to zero.
    // `delta` is movement against the previous day, which only the board knows
    // — the API sends a season, not a comparison. Default it to 0 so the type
    // holds and the UI shows "even" rather than rendering `undefined`.
    const withDelta = fetched.map((r) => ({ ...r, delta: r.delta ?? 0 }));
    const byKey = new Map(withDelta.map((r) => [r.date, r]));
    const season: PlayerSeason = {
      current: withDelta.reduce((latest, r) =>
        sortKey(r.date) > sortKey(latest.date) ? r : latest,
      ),
      history: DATES.map((date) => {
        const row = byKey.get(date.key);
        return {
          date,
          missing: !row,
          rank: row ? row.calculatedRank : null,
          score: row ? row.mvpValue : null,
        };
      }),
    };

    seasonCache.set(playerName, season);
    return season;
  };

  return {
    TEAMS,
    PLAYERS,
    ROSTER,
    DATES,
    MISSING,
    TODAY_KEY,
    snapshot,
    dateIndex,
    previousWithData,
    nearestWithData,
    rankings,
    history,
    findPlayer,
    loadPlayerSeason,
    nextGames,
  };
}
