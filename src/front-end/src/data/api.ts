// Live data source: the same shape, read from the Express API.
//
//   GET /daily-mvp-rankings?top=N         the board — top N players per date
//   GET /players                          every player in the league, for search
//   GET /players/:name/daily-mvp-rankings  one player's full season, ranks included
//   GET /daily-mvp-rankings/:date?around=  one date's field around one player
//
// The board and the roster are fetched once at startup and indexed in memory,
// so the component tree stays synchronous. Individual seasons are fetched only
// when someone opens a profile that the board did not include.
//
// ── Why the roster is a separate request ───────────────────────────────────
//
// The board is a top N per date because the whole collection is 83,054 rows.
// But only 137 of 582 players ever reach a top 50, so a board-only app can
// search barely a fifth of the league. The roster endpoint returns one small
// row per player — enough to find anyone — and the season endpoint fills in the
// rest on demand.

import { buildDataSource } from "./build-source";
import type { DataSource, FieldWindow, RankedPlayer, RosterEntry, StoredRow } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

/**
 * Players per date to load for the board.
 *
 * Deep enough that the visible leaderboard and its day-to-day movement are all
 * local, small enough to stay a few megabytes. Anyone outside it is still
 * findable through the roster and loadable through the season endpoint.
 */
const BOARD_DEPTH = 50;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadApiSource(): Promise<DataSource> {
  const [rows, roster] = await Promise.all([
    getJson<StoredRow[]>(`/daily-mvp-rankings?top=${BOARD_DEPTH}`),
    // A missing or failing roster must not take the whole app down — the board
    // is the product, and search degrades to the players already loaded.
    getJson<RosterEntry[]>("/players").catch(() => undefined),
  ]);

  return buildDataSource(rows, "The API", {
    roster,
    fetchPlayerSeason: async (playerName) => {
      const path = `/players/${encodeURIComponent(playerName)}/daily-mvp-rankings`;
      const res = await fetch(`${API_BASE}${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return (await res.json()) as RankedPlayer[];
    },
    // A 404 here means the player has no row on that date — he had not made his
    // season debut. That is an answer, not a failure, so it resolves null and
    // the profile says he had not played rather than showing a rank of nothing.
    fetchFieldAround: async (playerName, dateKey, window) => {
      const path =
        `/daily-mvp-rankings/${encodeURIComponent(dateKey)}` +
        `?around=${encodeURIComponent(playerName)}&window=${window}`;
      const res = await fetch(`${API_BASE}${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return (await res.json()) as FieldWindow;
    },
  });
}
