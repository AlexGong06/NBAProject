// Live data source: builds the same DataSource shape from the Express API.
//
//   GET /daily-mvp-rankings          every record across all dates, date desc
//   GET /daily-mvp-rankings/:date    one date, 404 when no scrape ran
//
// The whole window is fetched once and derived in memory so the component tree
// can stay synchronous and identical to the fixture path.

import { breakdown } from "./fixture";
import type {
  DataSource, DateInfo, Game, HistoryPoint, PlayerStats, RankedPlayer, Snapshot,
} from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

/** "2-17-2026" → DateInfo */
function toDateInfo(dateKey: string): DateInfo {
  const [m, d, y] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    key: dateKey,
    short: `${MONTHS[dt.getMonth()]} ${dt.getDate()}`,
    iso: dt.toISOString().slice(0, 10),
    long: `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`,
    weekday: WEEKDAYS[dt.getDay()],
  };
}

function sortKey(dateKey: string): number {
  const [m, d, y] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * Builds a DataSource from the API. Any date inside the observed window with no
 * rows is treated as a collector failure, which is what drives the empty state.
 */
export async function loadApiSource(): Promise<DataSource> {
  const res = await fetch(`${API_BASE}/daily-mvp-rankings`);
  if (!res.ok) throw new Error(`GET /daily-mvp-rankings failed: ${res.status}`);
  const records: (PlayerStats & { date: string; calculatedRank?: number })[] = await res.json();

  if (!records.length) throw new Error("API returned no ranking records");

  // Group by date.
  const byDate = new Map<string, typeof records>();
  for (const r of records) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  const presentKeys = [...byDate.keys()].sort((a, b) => sortKey(a) - sortKey(b));

  // Fill the calendar between the first and last observed date so gaps surface
  // as missing days rather than silently collapsing.
  const first = new Date(sortKey(presentKeys[0]));
  const last = new Date(sortKey(presentKeys[presentKeys.length - 1]));
  const DATES: DateInfo[] = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    DATES.push(toDateInfo(`${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`));
  }

  const MISSING = new Set(DATES.filter((d) => !byDate.has(d.key)).map((d) => d.key));
  const TODAY_KEY = DATES[DATES.length - 1].key;

  const SNAPSHOTS: Snapshot[] = DATES.map((date) => {
    const raw = byDate.get(date.key);
    if (!raw) return { date, missing: true, rows: [] };
    const rows = raw
      .map((p) => ({ ...p, ...breakdown(p) }))
      .sort((a, b) => b.mvpValue - a.mvpValue)
      .map((r, n) => ({ ...r, calculatedRank: r.calculatedRank ?? n + 1, date: date.key }));
    return { date, missing: false, rows };
  });

  // Distinct players seen across the window, ordered by today's ranking.
  const seen = new Map<string, PlayerStats>();
  for (const s of SNAPSHOTS) for (const r of s.rows) if (!seen.has(r.player)) seen.set(r.player, r);
  const PLAYERS = [...seen.values()];

  const TEAMS: Record<string, string> = {};
  for (const p of PLAYERS) TEAMS[p.team] ??= p.team;

  const dateIndex = (dateKey: string) => DATES.findIndex((d) => d.key === dateKey);
  const snapshot = (dateKey: string) => SNAPSHOTS.find((s) => s.date.key === dateKey) ?? null;

  const previousWithData = (dateKey: string): Snapshot | null => {
    for (let i = dateIndex(dateKey) - 1; i >= 0; i--) if (!SNAPSHOTS[i].missing) return SNAPSHOTS[i];
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

  const rankings = (dateKey: string): RankedPlayer[] | null => {
    const snap = snapshot(dateKey);
    if (!snap || snap.missing) return null;
    const prev = previousWithData(dateKey);
    return snap.rows.map((r) => {
      const before = prev ? prev.rows.find((x) => x.player === r.player) : null;
      return { ...r, delta: before ? before.calculatedRank - r.calculatedRank : 0 };
    });
  };

  const history = (playerName: string, dateKey: string, days: number): HistoryPoint[] => {
    const end = dateIndex(dateKey);
    const start = Math.max(0, end - days + 1);
    return SNAPSHOTS.slice(start, end + 1).map((s) => {
      const row = s.missing ? null : s.rows.find((r) => r.player === playerName);
      return {
        date: s.date, missing: s.missing,
        rank: row ? row.calculatedRank : null,
        score: row ? row.mvpValue : null,
      };
    });
  };

  // No schedule endpoint exists yet, so live mode shows no upcoming games
  // rather than inventing them.
  const nextGames = (): Game[] => [];

  return {
    TEAMS, PLAYERS, DATES, MISSING, TODAY_KEY, breakdown,
    snapshot, dateIndex, previousWithData, nearestWithData,
    rankings, history,
    findPlayer: (name) => PLAYERS.find((p) => p.player === name),
    nextGames,
  };
}
