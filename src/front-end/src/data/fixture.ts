// Fixture data source: 30 days of deterministic mock scrapes, including three
// days where the collector failed. Lets the app run with no database.
//
// The formula in breakdown() is the same one the backend uses in
// src/services/mvp-calculation/calculate-player-value.ts:
//   Total Value = 0.5(Win Contribution) + 0.5(Total Stats)

import type {
  Breakdown,
  DataSource,
  DateInfo,
  Game,
  HistoryPoint,
  PlayerStats,
  RankedPlayer,
  Snapshot,
} from "./types";

export const TEAMS: Record<string, string> = {
  DEN: "Denver Nuggets", OKC: "Oklahoma City Thunder", LAL: "Los Angeles Lakers",
  MIL: "Milwaukee Bucks", BOS: "Boston Celtics", MIN: "Minnesota Timberwolves",
  SAS: "San Antonio Spurs", CLE: "Cleveland Cavaliers", NYK: "New York Knicks",
  PHI: "Philadelphia 76ers", GSW: "Golden State Warriors", DAL: "Dallas Mavericks",
  MEM: "Memphis Grizzlies", PHX: "Phoenix Suns", SAC: "Sacramento Kings",
  HOU: "Houston Rockets", ORL: "Orlando Magic", IND: "Indiana Pacers",
  MIA: "Miami Heat", ATL: "Atlanta Hawks", LAC: "Los Angeles Clippers",
  NOP: "New Orleans Pelicans", TOR: "Toronto Raptors", CHI: "Chicago Bulls",
};

export const PLAYERS: PlayerStats[] = [
  { player: "Nikola Jokić", team: "DEN", pos: "C", age: 30, teamWins: 38, teamLosses: 17, teamGamesPlayed: 55, gamesStarted: 54, gamesPlayed: 54, minutesPerGame: 36.1, pointsPerGame: 29.4, assistsPerGame: 10.8, reboundsPerGame: 12.6, blocksPerGame: 0.7, stealsPerGame: 1.8, foulsPerGame: 2.3, turnoversPerGame: 3.5, usageRate: 30.1, valueOverReplacement: 6.4, winShare: 10.2, boxPlusMinus: 12.8, trueShootingPercentage: 0.662 },
  { player: "Shai Gilgeous-Alexander", team: "OKC", pos: "G", age: 27, teamWins: 47, teamLosses: 8, teamGamesPlayed: 55, gamesStarted: 55, gamesPlayed: 55, minutesPerGame: 34.2, pointsPerGame: 32.6, assistsPerGame: 6.3, reboundsPerGame: 5.1, blocksPerGame: 1.0, stealsPerGame: 1.7, foulsPerGame: 2.1, turnoversPerGame: 2.4, usageRate: 33.8, valueOverReplacement: 5.9, winShare: 11.4, boxPlusMinus: 10.1, trueShootingPercentage: 0.639 },
  { player: "Luka Dončić", team: "LAL", pos: "G", age: 26, teamWins: 34, teamLosses: 18, teamGamesPlayed: 52, gamesStarted: 33, gamesPlayed: 33, minutesPerGame: 36.8, pointsPerGame: 33.1, assistsPerGame: 8.9, reboundsPerGame: 8.4, blocksPerGame: 0.5, stealsPerGame: 1.6, foulsPerGame: 2.4, turnoversPerGame: 4.1, usageRate: 34.9, valueOverReplacement: 5.1, winShare: 8.2, boxPlusMinus: 9.4, trueShootingPercentage: 0.607 },
  { player: "Victor Wembanyama", team: "SAS", pos: "C", age: 22, teamWins: 32, teamLosses: 16, teamGamesPlayed: 48, gamesStarted: 44, gamesPlayed: 44, minutesPerGame: 33.2, pointsPerGame: 26.1, assistsPerGame: 4.2, reboundsPerGame: 11.4, blocksPerGame: 3.7, stealsPerGame: 1.2, foulsPerGame: 2.9, turnoversPerGame: 3.4, usageRate: 30.6, valueOverReplacement: 5.4, winShare: 8.0, boxPlusMinus: 10.6, trueShootingPercentage: 0.606 },
  { player: "Giannis Antetokounmpo", team: "MIL", pos: "F", age: 31, teamWins: 31, teamLosses: 23, teamGamesPlayed: 54, gamesStarted: 41, gamesPlayed: 41, minutesPerGame: 34.0, pointsPerGame: 31.2, assistsPerGame: 6.5, reboundsPerGame: 11.9, blocksPerGame: 1.2, stealsPerGame: 0.9, foulsPerGame: 2.7, turnoversPerGame: 3.3, usageRate: 33.1, valueOverReplacement: 4.6, winShare: 8.9, boxPlusMinus: 9.0, trueShootingPercentage: 0.618 },
  { player: "Jayson Tatum", team: "BOS", pos: "F", age: 27, teamWins: 36, teamLosses: 19, teamGamesPlayed: 55, gamesStarted: 55, gamesPlayed: 55, minutesPerGame: 35.4, pointsPerGame: 27.3, assistsPerGame: 5.4, reboundsPerGame: 8.6, blocksPerGame: 0.6, stealsPerGame: 1.1, foulsPerGame: 2.2, turnoversPerGame: 2.8, usageRate: 29.4, valueOverReplacement: 4.2, winShare: 8.4, boxPlusMinus: 7.6, trueShootingPercentage: 0.601 },
  { player: "Donovan Mitchell", team: "CLE", pos: "G", age: 29, teamWins: 41, teamLosses: 14, teamGamesPlayed: 55, gamesStarted: 54, gamesPlayed: 54, minutesPerGame: 33.1, pointsPerGame: 27.8, assistsPerGame: 5.2, reboundsPerGame: 4.6, blocksPerGame: 0.4, stealsPerGame: 1.5, foulsPerGame: 2.3, turnoversPerGame: 2.5, usageRate: 30.9, valueOverReplacement: 3.9, winShare: 8.8, boxPlusMinus: 6.9, trueShootingPercentage: 0.612 },
  { player: "Anthony Edwards", team: "MIN", pos: "G", age: 24, teamWins: 33, teamLosses: 21, teamGamesPlayed: 54, gamesStarted: 54, gamesPlayed: 54, minutesPerGame: 35.9, pointsPerGame: 28.4, assistsPerGame: 4.9, reboundsPerGame: 5.7, blocksPerGame: 0.6, stealsPerGame: 1.3, foulsPerGame: 2.6, turnoversPerGame: 3.1, usageRate: 31.2, valueOverReplacement: 3.8, winShare: 7.1, boxPlusMinus: 6.4, trueShootingPercentage: 0.594 },
];

export function breakdown(p: PlayerStats): Breakdown {
  const teamWinRatio = p.teamGamesPlayed > 0 ? p.teamWins / p.teamGamesPlayed : 0;
  const availability =
    p.teamGamesPlayed > 0 ? p.gamesPlayed / p.teamGamesPlayed : 0;
  const minutesFactor = p.minutesPerGame / 48;
  const usageFactor = p.usageRate / 100;
  const levelOfImpact = teamWinRatio * minutesFactor * usageFactor;
  const qualityOfImpact =
    0.4 * (p.valueOverReplacement + p.winShare) + 0.2 * p.boxPlusMinus;
  const winContribution = levelOfImpact * qualityOfImpact;
  const totalStats =
    (p.pointsPerGame * p.trueShootingPercentage +
      1.5 * p.assistsPerGame +
      1.2 * p.reboundsPerGame +
      3 * p.blocksPerGame +
      3 * p.stealsPerGame -
      p.foulsPerGame -
      p.turnoversPerGame) /
    25;
  // Availability multiplies the whole score, not just the win half — see the
  // header comment on the backend's calculate-player-value.ts for why.
  const rawValue = 0.5 * winContribution + 0.5 * totalStats;
  return {
    teamWinRatio, availability, minutesFactor, usageFactor, levelOfImpact,
    qualityOfImpact, winContribution, rawValue, totalStats,
    mvpValue: availability * rawValue,
  };
}

/* ── Dates ─────────────────────────────────────────────────────────────── */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TODAY = new Date(2026, 1, 17); // Feb 17 2026
export const DAY_COUNT = 30;

function key(d: Date) { return `${d.getMonth() + 1}-${d.getDate()}-${d.getFullYear()}`; }
function shortLabel(d: Date) { return `${MONTHS[d.getMonth()]} ${d.getDate()}`; }

export const DATES: DateInfo[] = Array.from({ length: DAY_COUNT }, (_, i) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - (DAY_COUNT - 1 - i));
  return {
    key: key(d),
    short: shortLabel(d),
    iso: d.toISOString().slice(0, 10),
    long: `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
    weekday: WEEKDAYS[d.getDay()],
  };
});

/** Days the scraper failed. The real API 404s on these. */
export const MISSING = new Set(["1-28-2026", "2-5-2026", "2-11-2026"]);
export const TODAY_KEY = DATES[DAY_COUNT - 1].key;

/* ── Per-day scores (deterministic drift around the season figures) ────── */
function wobble(i: number, d: number, salt: number) {
  const s = Math.sin((i + 1) * 12.9898 + (d + 1) * 78.233 + salt * 3.71) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const SNAPSHOTS: Snapshot[] = DATES.map((date, d) => {
  const rows = PLAYERS.map((p, i) => {
    const b = breakdown(p);
    // Today is the unperturbed season figure; earlier days drift around it.
    const drift = d === DAY_COUNT - 1 ? 0 : 1;
    const wc = b.winContribution * (1 + 0.13 * Math.sin(d * 0.33 + i * 1.9) * drift + 0.05 * wobble(i, d, 1) * drift);
    const ts = b.totalStats * (1 + 0.085 * Math.sin(d * 0.21 + i * 2.7) * drift + 0.04 * wobble(i, d, 2) * drift);
    // Availability applies here exactly as it does in breakdown(). Forgetting
    // it produced a board whose ranks did not match its own scores.
    const rawValue = 0.5 * (wc + ts);
    return {
      ...p, ...b,
      winContribution: wc, totalStats: ts, rawValue,
      mvpValue: b.availability * rawValue,
    };
  }).sort((a, b) => b.mvpValue - a.mvpValue);

  const ranked = rows.map((r, n) => ({ ...r, calculatedRank: n + 1, date: date.key }));
  const missing = MISSING.has(date.key);
  return { date, missing, rows: missing ? [] : ranked };
});

export function snapshot(dateKey: string): Snapshot | null {
  return SNAPSHOTS.find((s) => s.date.key === dateKey) ?? null;
}

export function dateIndex(dateKey: string): number {
  return DATES.findIndex((d) => d.key === dateKey);
}

/** Previous date that actually has data, used for rank deltas. */
export function previousWithData(dateKey: string): Snapshot | null {
  for (let i = dateIndex(dateKey) - 1; i >= 0; i--) {
    if (!SNAPSHOTS[i].missing) return SNAPSHOTS[i];
  }
  return null;
}

export function nearestWithData(dateKey: string, count: number): DateInfo[] {
  const idx = dateIndex(dateKey);
  const out: DateInfo[] = [];
  for (let r = 1; r < DAY_COUNT && out.length < count; r++) {
    [idx - r, idx + r].forEach((j) => {
      if (out.length < count && j >= 0 && j < DAY_COUNT && !SNAPSHOTS[j].missing) {
        out.push(SNAPSHOTS[j].date);
      }
    });
  }
  return out;
}

/** Rankings for a date, with delta vs the previous day that has data. */
export function rankings(dateKey: string): RankedPlayer[] | null {
  const snap = snapshot(dateKey);
  if (!snap || snap.missing) return null;
  const prev = previousWithData(dateKey);
  return snap.rows.map((r) => {
    const before = prev ? prev.rows.find((x) => x.player === r.player) : null;
    return { ...r, delta: before ? before.calculatedRank - r.calculatedRank : 0 };
  });
}

/** Rank + score history for one player over the last `days` days ending at dateKey. */
export function history(playerName: string, dateKey: string, days: number): HistoryPoint[] {
  const end = dateIndex(dateKey);
  const start = Math.max(0, end - days + 1);
  return SNAPSHOTS.slice(start, end + 1).map((s) => {
    const row = s.missing ? null : s.rows.find((r) => r.player === playerName);
    return {
      date: s.date,
      missing: s.missing,
      rank: row ? row.calculatedRank : null,
      score: row ? row.mvpValue : null,
    };
  });
}

export function findPlayer(name: string): PlayerStats | undefined {
  return PLAYERS.find((p) => p.player === name);
}

/* ── Schedule ──────────────────────────────────────────────────────────── */
const SCHEDULE_POOL = ["NYK", "PHI", "GSW", "DAL", "MEM", "PHX", "SAC", "HOU", "ORL", "IND", "MIA", "ATL", "LAC", "NOP", "TOR", "CHI", "BOS", "CLE", "MIN", "MIL"];

export function nextGames(playerName: string): Game[] {
  const i = PLAYERS.findIndex((p) => p.player === playerName);
  const self = PLAYERS[i];
  const out: Game[] = [];
  let cursor = new Date(TODAY);
  let step = 0;
  while (out.length < 10) {
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + (step % 3 === 0 ? 2 : 1));
    step++;
    const pick = SCHEDULE_POOL[(i * 7 + out.length * 3) % SCHEDULE_POOL.length];
    if (pick === self.team) continue;
    const home = (i + out.length) % 2 === 0;
    out.push({
      id: `${playerName}-${out.length}`,
      dateShort: shortLabel(cursor),
      weekday: WEEKDAYS[cursor.getDay()],
      opp: pick,
      oppName: TEAMS[pick],
      home,
      vs: home ? "vs" : "@",
      tip: ["7:00 PM", "7:30 PM", "8:00 PM", "9:30 PM", "10:00 PM"][(i + out.length) % 5],
      arena: home ? `${TEAMS[self.team]} — home` : TEAMS[pick],
      priceFrom: 38 + ((i * 13 + out.length * 17) % 9) * 11,
    });
  }
  return out;
}

export const fixtureSource: DataSource = {
  TEAMS, PLAYERS, DATES, MISSING, TODAY_KEY,
  breakdown, snapshot, dateIndex, previousWithData, nearestWithData,
  rankings, history, findPlayer, nextGames,
};
