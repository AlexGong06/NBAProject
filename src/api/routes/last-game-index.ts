// "What was this player's most recent game on or before this date?", answered
// for a whole board at once.
//
// ── Why an index rather than a query per row ───────────────────────────────
//
// The rankings board is a top N for each of 164 dates — 8,200 rows at the
// default depth — and every row carries a chip showing that player's last game
// *as of that row's date*. Asking the database once per row is 8,200 queries for
// one page load.
//
// So both source collections are read once and joined in memory. They are small
// enough for this to be the cheap option: 26,638 player-games projected to four
// fields, and 1,230 summaries. The season is complete and nothing new arrives —
// see CLAUDE.md — so the result is cached for the process lifetime rather than
// rebuilt per request.

import { getDb } from "../../database/database";

const LOGS = "PlayerGameLogs2526";
const SUMMARIES = "GameSummaries2526";
const HIGHLIGHTS = "PlayerGameHighlights";

/**
 * The chip's whole payload. Six numbers and a game id — deliberately not a box
 * score, which is what `/games/:gameId` is for.
 */
export type LastGameSummary = {
  gameId: string;
  /** "M-D-YYYY", the key form the rest of the app queries by. */
  date: string;
  isoDate: string;
  opponentAbbr: string;
  opponentTeamId: number;
  teamAbbr: string;
  teamId: number;
  home: boolean;
  neutralSite: boolean;
  teamScore: number;
  opponentScore: number;
  win: boolean;
  overtime: boolean;
  hasHighlight: boolean;
  /**
   * What the player did in *that game* — not his season averages.
   *
   * The drawer prints these beside the button ("29 pts · 16 reb · 12 ast"), and
   * under a label naming a specific date they can only mean the line from that
   * date. Season averages there would read as a box score and be wrong by a
   * quiet margin.
   */
  points: number;
  rebounds: number;
  assists: number;
};

type PlayerGameRef = { isoDate: string; summary: LastGameSummary };

type Index = {
  /** playerId → his games, oldest first. */
  byPlayer: Map<number, PlayerGameRef[]>;
};

let cached: Promise<Index> | null = null;

/** "2026-04-12" → "4-12-2026", without going through a Date and a timezone. */
function toDateKey(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(m)}-${Number(d)}-${y}`;
}

async function build(): Promise<Index> {
  const db = await getDb();

  const [logs, summaries, highlights] = await Promise.all([
    db
      .collection(LOGS)
      .find(
        {},
        {
          projection: {
            _id: 0, playerId: 1, gameId: 1, date: 1, teamId: 1, teamAbbr: 1,
            points: 1, rebounds: 1, assists: 1,
          },
        },
      )
      .toArray(),
    db.collection(SUMMARIES).find({}).toArray(),
    // Only the ids that actually resolved to a video. A game with no reel is a
    // real answer, and the chip needs to know which it is before offering to
    // play something.
    db.collection(HIGHLIGHTS).distinct("gameId", { videoId: { $ne: null } }),
  ]);

  const summaryById = new Map<string, any>(summaries.map((s: any) => [s.gameId, s]));
  const withHighlight = new Set<string>(highlights as string[]);

  const byPlayer = new Map<number, PlayerGameRef[]>();

  for (const row of logs as any[]) {
    const s = summaryById.get(row.gameId);
    if (!s) continue;

    const isHome = row.teamId === s.homeTeamId;
    const teamScore = isHome ? s.homeScore : s.awayScore;
    const opponentScore = isHome ? s.awayScore : s.homeScore;

    const summary: LastGameSummary = {
      gameId: row.gameId,
      date: toDateKey(row.date),
      isoDate: row.date,
      opponentAbbr: isHome ? s.awayAbbr : s.homeAbbr,
      opponentTeamId: isHome ? s.awayTeamId : s.homeTeamId,
      teamAbbr: row.teamAbbr,
      teamId: row.teamId,
      home: isHome,
      neutralSite: s.neutralSite ?? false,
      teamScore,
      opponentScore,
      win: teamScore > opponentScore,
      overtime: (s.overtimePeriods ?? 0) > 0,
      hasHighlight: withHighlight.has(row.gameId),
      points: row.points,
      rebounds: row.rebounds,
      assists: row.assists,
    };

    const list = byPlayer.get(row.playerId) ?? [];
    list.push({ isoDate: row.date, summary });
    byPlayer.set(row.playerId, list);
  }

  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
  }

  return { byPlayer };
}

export function lastGameIndex(): Promise<Index> {
  if (!cached) cached = build();
  return cached;
}

/**
 * The player's most recent game on or before `isoDate`, or null before his
 * first appearance.
 *
 * Binary search rather than a scan: this runs once per board row, and a linear
 * walk over an 82-game season 8,200 times is work for nothing.
 */
export function lastGameFor(
  index: Index,
  playerId: number,
  isoDate: string,
): LastGameSummary | null {
  const games = index.byPlayer.get(playerId);
  if (!games || games.length === 0) return null;

  let lo = 0;
  let hi = games.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (games[mid].isoDate <= isoDate) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found === -1 ? null : games[found].summary;
}
