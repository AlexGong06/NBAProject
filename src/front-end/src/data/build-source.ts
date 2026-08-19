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
  DataSource, DateInfo, FieldWindow, Game, HistoryPoint, PlayerSeason,
  RankedPlayer, RosterEntry, Snapshot, StoredRow,
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
  /**
   * Fetch one date's field around a player, ranked against the whole league.
   *
   * The board cannot answer this. It is a top N, so it knows where a player
   * stands only on the dates he was in the top N — and reporting a position
   * within 50 loaded rows as a league rank is precisely the failure this
   * replaces.
   */
  fetchFieldAround?: (
    playerName: string,
    dateKey: string,
    window: number,
  ) => Promise<FieldWindow | null>;
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

  /**
   * Fetched season rows, player → date key → row. Backs the synchronous
   * `rowFor`, which needs whole rows rather than the rank/score pairs a
   * `HistoryPoint` carries.
   */
  const seasonRows = new Map<string, Map<string, RankedPlayer>>();

  /**
   * In-flight season fetches, so concurrent callers share one request.
   *
   * The chart's field mode asks for several players at once and the profile
   * asks for one of them itself; without this they race and fetch the same
   * season twice.
   */
  const inFlight = new Map<string, Promise<PlayerSeason | null>>();

  const history = (playerName: string, dateKey: string, days: number): HistoryPoint[] => {
    const end = dateIndex(dateKey);
    const start = Math.max(0, end - days + 1);

    // A fetched season wins outright, and is already aligned to DATES so the
    // same window applies.
    //
    // This used to defer to the board whenever the player appeared in it on any
    // date at all. That is backwards: the board holds a player only on the days
    // he made the top N, so for someone who cracked it once in November it
    // returned a single point and 163 nulls — a chart that renders as an empty
    // grid and reads as "no data" rather than "the board never saw him".
    const fetched = seasonCache.get(playerName);
    if (fetched) return fetched.history.slice(start, end + 1);

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
        // Carried through so search results can show a headshot. The fixture
        // has no `playerId`, but `profileUrl` embeds one — see headshot.ts.
        playerId: p.playerId,
        profileUrl: p.profileUrl,
      }));

  /**
   * A player's whole season, ranked against the whole league.
   *
   * ── Why board membership is not a shortcut ──────────────────────────────
   *
   * This used to return early whenever `findPlayer` hit, on the reasoning that
   * a player already in memory needs no request. But `PLAYERS` holds each
   * player's latest row *within the loaded board*, and the board is a top N per
   * date. A player who reached the top 50 once — Gary Payton II did, on a
   * one-game sample in November — was therefore served that single row as his
   * season: his November rank shown as his current rank, out of a field of 50
   * presented as the league, with a chart that had one point in it.
   *
   * So the season endpoint wins whenever the source has one. The board is the
   * fallback, not the shortcut.
   */
  const loadPlayerSeason = async (playerName: string): Promise<PlayerSeason | null> => {
    if (seasonCache.has(playerName)) return seasonCache.get(playerName) ?? null;

    const pending = inFlight.get(playerName);
    if (pending) return pending;

    // Everything the board alone can offer: the days this player was in the top
    // N, ranked within it. Honest for the offline fixture, which has no deeper
    // source, and used only when there is no season to fetch.
    const fromBoard = (): PlayerSeason | null => {
      const local = findPlayer(playerName);
      if (!local) return null;
      return {
        current: local,
        history: SNAPSHOTS.map((s) => {
          const row = s.missing ? null : s.rows.find((r) => r.player === playerName);
          return {
            date: s.date,
            missing: s.missing,
            rank: row ? row.calculatedRank : null,
            score: row ? row.mvpValue : null,
          };
        }),
      };
    };

    const load = async (): Promise<PlayerSeason | null> => {
      const fetched = extras.fetchPlayerSeason
        ? await extras.fetchPlayerSeason(playerName)
        : null;

      if (!fetched || fetched.length === 0) {
        const board = fromBoard();
        seasonCache.set(playerName, board);
        return board;
      }

      // Index the fetched rows by date so history lines up with the calendar the
      // rest of the app already built. Dates the player has no row for stay
      // missing rather than being drawn as a drop to zero.
      // `delta` is movement against the previous day, which only the board knows
      // — the API sends a season, not a comparison. Default it to 0 so the type
      // holds and the UI shows "even" rather than rendering `undefined`.
      const withDelta = fetched.map((r) => ({ ...r, delta: r.delta ?? 0 }));
      const byKey = new Map(withDelta.map((r) => [r.date, r]));
      seasonRows.set(playerName, byKey);

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

    const request = load().finally(() => inFlight.delete(playerName));
    inFlight.set(playerName, request);
    return request;
  };

  /**
   * The player's row on one date — his numbers, not his position.
   *
   * Rank deliberately does not come from here. A board row carries its rank
   * within the loaded top N, which is not a league rank; `fieldAround` is what
   * knows the difference and says so.
   */
  const rowFor = (playerName: string, dateKey: string): RankedPlayer | null => {
    const fetched = seasonRows.get(playerName)?.get(dateKey);
    if (fetched) return fetched;

    const snap = snapshot(dateKey);
    if (!snap || snap.missing) return null;
    return snap.rows.find((r) => r.player === playerName) ?? null;
  };

  const fieldAround = async (
    playerName: string,
    dateKey: string,
    window: number,
  ): Promise<FieldWindow | null> => {
    if (extras.fetchFieldAround) {
      const field = await extras.fetchFieldAround(playerName, dateKey, window);
      if (field) return field;
    }

    // Board fallback. `complete: false` is the important part — these ranks are
    // positions within however many rows were loaded, and the UI has to be able
    // to tell that apart from a rank out of the whole league.
    const day = rankings(dateKey);
    if (!day) return null;

    const idx = day.findIndex((r) => r.player === playerName);
    if (idx === -1) return null;

    const start = Math.max(0, idx - window);
    return {
      rank: idx + 1,
      fieldSize: day.length,
      complete: false,
      rows: day.slice(start, start + window * 2 + 1),
    };
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
    fieldAround,
    rowFor,
    nextGames,
  };
}
