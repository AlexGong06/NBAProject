// Turns a flat list of stored ranking rows into the shape the UI reads.
//
// This is the whole of the front end's data layer. Both sources — the bundled
// fixture and the live API — produce the same array of rows and hand it here,
// so there is exactly one implementation of grouping, gap detection, ranking
// and history.
//
// Nothing in this file computes a score. Every number the UI shows was
// calculated once, by the backend, when the season was built, and stored. That is
// deliberate: the app used to re-run the MVP formula in the browser to recover
// intermediate terms the database had thrown away, which gave one calculation
// two implementations that could disagree — and they did.

import { TEAMS } from "./teams";
import type {
  DataSource, DateInfo, FieldWindow, Game, HistoryPoint, PlayerSeason,
  PlayerGame, RankedPlayer, RosterEntry, Snapshot, Standings, StoredRow,
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
 * "2026-04-12" → "4-12-2026".
 *
 * Split on the parts rather than going through a Date. Parsing a bare ISO date
 * gives UTC midnight, which renders as the previous day for anyone west of
 * Greenwich — the same trap documented in build-season.ts.
 */
function isoToDateKey(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y}`;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
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
  /**
   * Fetch one game, from a player's side. Resolves null when the source has no
   * game data — the offline fixture never has.
   */
  fetchGame?: (
    playerName: string,
    query: { gameId: string } | { onOrBefore: string },
  ) => Promise<PlayerGame | null>;
  /**
   * The ISO dates games were played on.
   *
   * Supplied, the season's shape no longer has to be inferred from a full set
   * of rows — which is what made the app download 11.47 MB before rendering.
   * Omitted, the calendar is derived from `rows` exactly as before, which is
   * what the offline fixture does.
   */
  calendar?: string[];
  /**
   * Every player's rank and value on every date, four fields per point.
   *
   * This is what lets the charts work for dates whose rows were never loaded.
   * 56 KB gzipped for the whole season, against 11.47 MB of full rows.
   */
  series?: SeriesPoint[];
  /** Fetch one date's full rows, for the board. */
  fetchDate?: (dateKey: string) => Promise<StoredRow[] | null>;
};

/** One player's standing on one date: the whole of what a chart needs. */
export type SeriesPoint = {
  /** player */
  p: string;
  /** date key, "M-D-YYYY" */
  d: string;
  /** rank */
  r: number;
  /** mvpValue */
  v: number;
};

export function buildDataSource(
  rows: StoredRow[],
  source: string,
  extras: SourceExtras = {},
): DataSource {
  if (!rows.length && !extras.series?.length) {
    throw new Error(`${source} returned no ranking rows`);
  }
  if (rows.length) assertRowsAreComplete(rows, source);

  // ── Full rows, per date, loaded on demand ────────────────────────────────
  //
  // The board needs every field of every visible row, but only for the date on
  // screen. Whatever `rows` arrived with seeds this; `ensureDate` fills in the
  // rest as the reader moves.
  const rowsByDate = new Map<string, RankedPlayer[]>();

  const rankRows = (dateKey: string, dayRows: StoredRow[]): RankedPlayer[] =>
    // Ordered by the stored score, and the rank is the resulting position —
    // never a rank that arrived on the row. A stored rank beside a score from a
    // different formula run is how a board ends up disagreeing with itself.
    [...dayRows]
      .sort((a, b) => b.mvpValue - a.mvpValue)
      .map((r, n) => ({ ...r, calculatedRank: n + 1, date: dateKey, delta: 0 }));

  for (const [dateKey, dayRows] of groupBy(rows, (r) => r.date)) {
    rowsByDate.set(dateKey, rankRows(dateKey, dayRows));
  }

  // ── Rank and value, per date, for the whole season ───────────────────────
  //
  // Four fields per player-date. This is what the charts read, and it is why
  // they keep working for dates whose full rows were never fetched. Derived
  // from the rows when no series is supplied, so the offline fixture is
  // unchanged.
  const seriesByDate = new Map<string, Map<string, { rank: number; score: number }>>();

  if (extras.series?.length) {
    for (const point of extras.series) {
      let day = seriesByDate.get(point.d);
      if (!day) seriesByDate.set(point.d, (day = new Map()));
      day.set(point.p, { rank: point.r, score: point.v });
    }
  } else {
    for (const [dateKey, ranked] of rowsByDate) {
      const day = new Map<string, { rank: number; score: number }>();
      for (const r of ranked) day.set(r.player, { rank: r.calculatedRank, score: r.mvpValue });
      seriesByDate.set(dateKey, day);
    }
  }

  // Every calendar day between the first and last game, so a day the NBA did
  // not play stays visible on the timeline instead of vanishing from it.
  //
  // A day with no games is Thanksgiving, Christmas Eve, the NBA Cup final, the
  // All-Star break. There are ten of them in 2025-26 and not one is a failure
  // to collect: the season is rebuilt retroactively from the NBA stats API, in
  // one pass, so there is no run that could have missed.
  const gameDayKeys = new Set(
    extras.calendar?.length
      ? extras.calendar.map(isoToDateKey)
      : [...seriesByDate.keys()],
  );

  const present = [...gameDayKeys].sort((a, b) => sortKey(a) - sortKey(b));

  const DATES: DateInfo[] = [];
  const first = new Date(sortKey(present[0]));
  const last = new Date(sortKey(present[present.length - 1]));
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    DATES.push(toDateInfo(`${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`));
  }

  const NO_GAME_DAYS = new Set(DATES.filter((d) => !gameDayKeys.has(d.key)).map((d) => d.key));
  const TODAY_KEY = DATES[DATES.length - 1].key;

  const dateIndex = (dateKey: string) => DATES.findIndex((d) => d.key === dateKey);
  const dateInfo = (dateKey: string) => DATES.find((d) => d.key === dateKey) ?? null;

  /**
   * A date's board, as far as it is known.
   *
   * `rows` is empty both for a day with no games and for a game day whose rows
   * have not been fetched yet — `noGames` is what tells them apart, and it is
   * answered from the calendar rather than from whether anything is loaded.
   */
  const snapshot = (dateKey: string): Snapshot | null => {
    const date = dateInfo(dateKey);
    if (!date) return null;
    return {
      date,
      noGames: NO_GAME_DAYS.has(dateKey),
      rows: rowsByDate.get(dateKey) ?? [],
    };
  };

  const previousWithData = (dateKey: string): Snapshot | null => {
    for (let i = dateIndex(dateKey) - 1; i >= 0; i--) {
      if (!NO_GAME_DAYS.has(DATES[i].key)) return snapshot(DATES[i].key);
    }
    return null;
  };

  /**
   * The game day whose standings are in effect on `dateKey`.
   *
   * Itself when games were played; otherwise the most recent game day before
   * it. Nobody played on Feb 15, so the standings on Feb 15 are the standings
   * from Feb 12 — not an absence, and certainly not an error.
   *
   * Every date-scoped read goes through here. The first date in the calendar is
   * a game day by construction (the calendar is built from the dates that have
   * rows), so this only returns null for a key outside the season.
   */
  const effectiveDate = (dateKey: string): DateInfo | null => {
    const snap = snapshot(dateKey);
    if (!snap) return null;
    if (!snap.noGames) return snap.date;
    return previousWithData(dateKey)?.date ?? null;
  };

  const nearestGameDays = (dateKey: string, count: number): DateInfo[] => {
    const idx = dateIndex(dateKey);
    const out: DateInfo[] = [];
    for (let r = 1; r < DATES.length && out.length < count; r++) {
      [idx - r, idx + r].forEach((j) => {
        if (out.length < count && j >= 0 && j < DATES.length && !NO_GAME_DAYS.has(DATES[j].key)) {
          out.push(DATES[j]);
        }
      });
    }
    return out;
  };

  /**
   * Rankings as they stood on a date, with movement measured against the
   * previous game day.
   *
   * Strict: a day with no games has no board of its own and returns null. Use
   * `standingsFor` to ask the question a reader actually asks — "what were the
   * standings on this date" — which on an off day is answered by the previous
   * game day rather than by silence.
   */
  const rankings = (dateKey: string): RankedPlayer[] | null => {
    const snap = snapshot(dateKey);
    if (!snap || snap.noGames) return null;
    // An unfetched game day is not an empty one. `isDateLoaded` is what the UI
    // asks; returning [] here would render a real date as a board with nobody
    // on it.
    if (!rowsByDate.has(dateKey)) return null;

    // Movement comes from the series, not from the previous day's rows, so a
    // delta is available whether or not that day was ever fetched.
    const prev = previousWithData(dateKey);
    const before = prev ? seriesByDate.get(prev.date.key) : undefined;

    return snap.rows.map((r) => {
      const was = before?.get(r.player);
      return { ...r, delta: was ? was.rank - r.calculatedRank : 0 };
    });
  };

  /**
   * Whether the rows this date renders from are in memory.
   *
   * Resolved through the effective date: on a day with no games the board shows
   * the previous game day's rows, so that is what "loaded" has to mean.
   */
  const isDateLoaded = (dateKey: string) => {
    const asOf = effectiveDate(dateKey);
    return asOf ? rowsByDate.has(asOf.key) : false;
  };

  // ── Fetching a date's rows ───────────────────────────────────────────────
  //
  // Deduped in flight, like `loadPlayerSeason` and `loadGame`: the ribbon can
  // fire several picks in quick succession, and each date should cost at most
  // one request.
  const datesInFlight = new Map<string, Promise<void>>();

  const ensureDate = (dateKey: string): Promise<void> => {
    // Resolved through the effective date, like every other date-scoped read.
    // On a day with no games the board shows the previous game day's standings,
    // so that is the date whose rows have to be in memory. Fetching only the
    // date asked for left the whole All-Star break blank — the banner and the
    // carried-forward board both depend on rows nobody had fetched.
    const asOf = effectiveDate(dateKey);
    if (!asOf) return Promise.resolve();

    const key = asOf.key;
    if (rowsByDate.has(key)) return Promise.resolve();
    if (!extras.fetchDate) return Promise.resolve();

    const pending = datesInFlight.get(key);
    if (pending) return pending;

    const request = extras
      .fetchDate(key)
      .then((fetched) => {
        if (fetched?.length) rowsByDate.set(key, rankRows(key, fetched));
      })
      .finally(() => datesInFlight.delete(key));

    datesInFlight.set(key, request);
    return request;
  };

  /**
   * The standings in effect on a date, off days included.
   *
   * `asOf` is the game day the rows come from and `noGames` says whether that
   * differs from the date asked for, so the caller can show a board *and* say
   * why it has not moved. The board used to render an error page here, which
   * described six days of the All-Star break as six days of broken data.
   */
  const standingsFor = (dateKey: string): Standings | null => {
    const asOf = effectiveDate(dateKey);
    if (!asOf) return null;

    const rows = rankings(asOf.key);
    if (!rows) return null;

    return { rows, asOf, noGames: asOf.key !== dateKey };
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

  /**
   * Project a player's values onto the season calendar, carrying the last
   * observed value across days the NBA did not play.
   *
   * ── Why carry forward ──────────────────────────────────────────────────
   *
   * A player's rank on Feb 15 is his rank from Feb 12, because nobody played in
   * between. Leaving those days null drew the All-Star break as a six-day hole
   * with a dashed line across it, captioned "no scrape" — a rendering of broken
   * data where there is none. Carrying the value forward draws a flat line,
   * which is what actually happened.
   *
   * The two reasons a day can have no value stay distinct: `noGames` belongs to
   * the date, and a null rank on a *game* day belongs to the player — he had
   * not debuted, or the loaded board never held him. Only the first is carried.
   */
  const projectHistory = (
    valueAt: (dateKey: string) => { rank: number; score: number } | null,
  ): HistoryPoint[] => {
    let last: { rank: number; score: number } | null = null;

    return DATES.map((date) => {
      const noGames = NO_GAME_DAYS.has(date.key);
      const observed = noGames ? null : valueAt(date.key);
      if (observed) last = observed;

      const carried = noGames && last !== null;
      const value = observed ?? (carried ? last : null);

      return {
        date,
        noGames,
        carried,
        rank: value ? value.rank : null,
        score: value ? value.score : null,
      };
    });
  };

  /** Board-derived histories, built once per player. */
  const boardHistory = new Map<string, HistoryPoint[]>();

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

    let projected = boardHistory.get(playerName);
    if (!projected) {
      // From the series, not from the loaded rows. This is the whole reason the
      // series exists: a sparkline covers fourteen dates, of which at most one
      // has its full rows in memory.
      projected = projectHistory((key) => seriesByDate.get(key)?.get(playerName) ?? null);
      boardHistory.set(playerName, projected);
    }

    return projected.slice(start, end + 1);
  };

  // Each player's most recent row, current leader first, every entry carrying a
  // full breakdown so the UI never has to look one up.
  //
  // The latest day is taken from rankings() so those entries carry real
  // movement; anyone who has dropped out of the tracked set since then is
  // appended with a zero delta, because there is nothing to compare against.
  const latest = new Map<string, RankedPlayer>();
  for (const r of rankings(TODAY_KEY) ?? []) latest.set(r.player, r);
  for (let i = DATES.length - 1; i >= 0; i--) {
    for (const r of rowsByDate.get(DATES[i].key) ?? []) {
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
        history: projectHistory((key) => seriesByDate.get(key)?.get(playerName) ?? null),
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
      // rest of the app already built. A game day the player has no row for —
      // he had not debuted — stays empty rather than being drawn as a drop to
      // zero; a day with no games is carried forward by projectHistory.
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
        history: projectHistory((key) => {
          const row = byKey.get(key);
          return row ? { rank: row.calculatedRank, score: row.mvpValue } : null;
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
   *
   * An off day resolves to the game day before it — his numbers on Feb 15 are
   * his numbers from Feb 12, because he did not play in between.
   */
  const rowFor = (playerName: string, dateKey: string): RankedPlayer | null => {
    const asOf = effectiveDate(dateKey);
    if (!asOf) return null;

    const fetched = seasonRows.get(playerName)?.get(asOf.key);
    if (fetched) return fetched;

    return snapshot(asOf.key)?.rows.find((r) => r.player === playerName) ?? null;
  };

  // ── Games ────────────────────────────────────────────────────────────────
  //
  // Cached by game id, and shared between in-flight callers, for the same
  // reason seasons are: stepping prev/next through a player's games walks back
  // over ones already fetched, and the board links straight into one.
  const gameCache = new Map<string, PlayerGame | null>();
  const gamesInFlight = new Map<string, Promise<PlayerGame | null>>();

  const fetchGameOnce = (
    key: string,
    run: () => Promise<PlayerGame | null>,
  ): Promise<PlayerGame | null> => {
    if (gameCache.has(key)) return Promise.resolve(gameCache.get(key) ?? null);

    const pending = gamesInFlight.get(key);
    if (pending) return pending;

    const request = run()
      .then((game) => {
        gameCache.set(key, game);
        // Also key it by id, so a game reached via "last game on this date" is
        // not fetched again when prev/next lands back on it.
        if (game) gameCache.set(`id:${game.gameId}`, game);
        return game;
      })
      .finally(() => gamesInFlight.delete(key));

    gamesInFlight.set(key, request);
    return request;
  };

  const loadGame = (playerName: string, gameId: string): Promise<PlayerGame | null> =>
    fetchGameOnce(`id:${gameId}`, async () =>
      extras.fetchGame ? extras.fetchGame(playerName, { gameId }) : null,
    );

  const loadLastGame = (playerName: string, dateKey: string): Promise<PlayerGame | null> => {
    // Resolved through the effective date so an off day asks about the game day
    // it inherits from, rather than about a date on which nobody played.
    const asOf = effectiveDate(dateKey);
    if (!asOf) return Promise.resolve(null);

    return fetchGameOnce(`last:${playerName}:${asOf.key}`, async () =>
      extras.fetchGame ? extras.fetchGame(playerName, { onOrBefore: asOf.key }) : null,
    );
  };

  const fieldAround = async (
    playerName: string,
    dateKey: string,
    window: number,
  ): Promise<FieldWindow | null> => {
    // Resolved before the request, not after. The API stores no rows for a day
    // with no games and correctly 404s for one, so asking it about Feb 15
    // returns nothing at all — the profile would report a player with no
    // standing rather than a player whose standing simply did not move.
    const asOf = effectiveDate(dateKey);
    if (!asOf) return null;

    if (extras.fetchFieldAround) {
      const field = await extras.fetchFieldAround(playerName, asOf.key, window);
      if (field) return field;
    }

    // Board fallback. `complete: false` is the important part — these ranks are
    // positions within however many rows were loaded, and the UI has to be able
    // to tell that apart from a rank out of the whole league.
    const day = rankings(asOf.key);
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
    NO_GAME_DAYS,
    TODAY_KEY,
    snapshot,
    dateIndex,
    previousWithData,
    nearestGameDays,
    effectiveDate,
    rankings,
    standingsFor,
    isDateLoaded,
    ensureDate,
    history,
    findPlayer,
    loadPlayerSeason,
    fieldAround,
    rowFor,
    loadLastGame,
    loadGame,
    nextGames,
  };
}
