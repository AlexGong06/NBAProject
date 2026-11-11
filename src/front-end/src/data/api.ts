// Live data source: the same shape, read from the Express API.
//
//   GET /seasons                          which seasons this API can serve
//   GET /calendar                         the dates games were played on
//   GET /calendar/series?top=N            rank & value per player per date
//   GET /daily-mvp-rankings/:date?top=N   one date's full rows
//   GET /players                          every player in the league, for search
//   GET /players/:name/daily-mvp-rankings  one player's full season, ranks included
//   GET /daily-mvp-rankings/:date?around=  one date's field around one player
//   GET /games/last?player=&date=       his most recent game on or before a date
//   GET /games/:gameId?player=           one game, from that player's side
//
// The board and the roster are fetched once at startup and indexed in memory,
// so the component tree stays synchronous. Individual seasons are fetched only
// when someone opens a profile the board did not include.
//
// The roster is its own request because only 137 of 582 players ever reach a
// top 50 — a board-only app could search barely a fifth of the league.

import { buildDataSource, formatSeasonLabel } from "./build-source";
import type { SeriesPoint } from "./build-source";
import type {
  DataSource, FieldWindow, PlayerGame, RankedPlayer, RosterEntry, SeasonOption,
  StoredRow,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

/** "2026-04-12" → "4-12-2026", without going through a Date and a timezone. */
function isoToDateKey(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y}`;
}

/** Deep enough that the board and its day-to-day movement are local. Anyone
 *  outside it is findable through the roster and loadable on demand. */
const BOARD_DEPTH = 50;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** What `GET /seasons` answers with. */
type SeasonsBody = {
  seasons: { season: string; gameDays: number; firstDate: string; lastDate: string }[];
  defaultSeason: string;
};

/**
 * Open on four small requests instead of one enormous one. Fetching every row
 * of every date up front was 11.47 MB and a two-second stall on arrival:
 *
 *   calendar    0.4 KB   which dates had games
 *   series     56.5 KB   every player's rank and value, for charts
 *   one date   14.4 KB   full rows, only for what is on screen
 *   roster     28.3 KB   all 582 players, for search
 *   ─────────────────
 *              99.6 KB   gzipped
 *
 * Switching dates then costs one 14 KB request (~170 ms), paid only by people
 * who actually scrub.
 */
export async function loadApiSource(season?: string): Promise<DataSource> {
  // Every request carries the season, or none of them do. Mixing the two would
  // build a source whose calendar came from one season and whose board came
  // from another — and since each response is individually valid, nothing
  // downstream could notice.
  const q = season ? `season=${encodeURIComponent(season)}` : "";
  const withSeason = (path: string) =>
    q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path;

  const [calendarBody, series, roster, seasonsBody] = await Promise.all([
    getJson<{ season: string; gameDates: string[] }>(withSeason("/calendar")),
    getJson<SeriesPoint[]>(withSeason(`/calendar/series?top=${BOARD_DEPTH}`)),
    // A missing or failing roster must not take the whole app down — the board
    // is the product, and search degrades to the players already loaded.
    getJson<RosterEntry[]>(withSeason("/players")).catch(() => undefined),
    // Nor must a missing season list: without it the picker simply does not
    // render, and the app serves the one season it loaded. An older API that
    // has no /seasons route degrades to exactly that.
    getJson<SeasonsBody>("/seasons").catch(() => undefined),
  ]);

  const calendar = calendarBody.gameDates;

  // Built from what the API reports, not from a list in the bundle: a season
  // added to the backend appears in the picker without rebuilding the site.
  const availableSeasons: SeasonOption[] = (seasonsBody?.seasons ?? []).map((s) => ({
    id: s.season,
    label: formatSeasonLabel(s.season),
    gameDays: s.gameDays,
    firstDate: s.firstDate,
    lastDate: s.lastDate,
  }));

  const fetchDate = async (dateKey: string): Promise<StoredRow[] | null> => {
    const path = withSeason(
      `/daily-mvp-rankings/${encodeURIComponent(dateKey)}?top=${BOARD_DEPTH}`,
    );
    const res = await fetch(`${API_BASE}${path}`);
    // 404 is the API's answer for a day with no regular-season games. The
    // calendar already knows which those are, so this is belt and braces.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return (await res.json()) as StoredRow[];
  };

  // The last date in the season, which is what the app opens on. Fetched here
  // rather than by the first render so the board has rows the moment it mounts.
  const latest = calendar[calendar.length - 1];
  const opening = latest ? await fetchDate(isoToDateKey(latest)).catch(() => null) : null;

  return buildDataSource(opening ?? [], "The API", {
    calendar,
    // What the API says it served, never what was asked for. With no
    // `?season=` the server picks, and the app must label what it actually got.
    season: calendarBody.season,
    availableSeasons,
    series,
    fetchDate,
    roster,
    fetchPlayerSeason: async (playerName) => {
      const path = withSeason(
        `/players/${encodeURIComponent(playerName)}/daily-mvp-rankings`,
      );
      const res = await fetch(`${API_BASE}${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return (await res.json()) as RankedPlayer[];
    },
    // A 404 here means the player has no row on that date — he had not made his
    // season debut. That is an answer, not a failure, so it resolves null and
    // the profile says he had not played rather than showing a rank of nothing.
    fetchFieldAround: async (playerName, dateKey, window) => {
      const path = withSeason(
        `/daily-mvp-rankings/${encodeURIComponent(dateKey)}` +
          `?around=${encodeURIComponent(playerName)}&window=${window}`,
      );
      const res = await fetch(`${API_BASE}${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return (await res.json()) as FieldWindow;
    },
    // A 404 means the player has no game on or before that date — he had not
    // debuted. That is an answer, so it resolves null and the panel says so.
    fetchGame: async (playerName, query) => {
      const player = encodeURIComponent(playerName);
      const path = withSeason(
        "gameId" in query
          ? `/games/${encodeURIComponent(query.gameId)}?player=${player}`
          : `/games/last?player=${player}&date=${encodeURIComponent(query.onOrBefore)}`,
      );

      const res = await fetch(`${API_BASE}${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return (await res.json()) as PlayerGame;
    },
  });
}
