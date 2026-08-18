// Rolling season-to-date aggregation.
//
// **Advanced statistics cannot be averaged across games.** Every one of them is
// a rate — a numerator over a denominator — and averaging two games' rates gives
// a 12-minute blowout the same weight as a 44-minute overtime game.
//
// The correct method recovers the raw volume, sums it, and re-divides:
//
//     rolling rate = Σ(game rate × game denominator) / Σ(game denominator)
//
// Each stat has its own denominator and using the wrong one is a silent error:
//
//     net / offensive / defensive rating   possessions
//     usage, PIE                           minutes
//     true shooting                        FGA + 0.44 × FTA
//     box score averages                   games played
//
// Why this matters more than it sounds: measured across all 26,651 player-games
// of 2025-26, a single game's PIE ranges from -11.0 to +6.0 and net rating from
// -400 to +300. Those are real — a two-minute garbage-time appearance where the
// denominator is almost nothing. Weighted, a season collapses to sane values
// (season PIE tops out near 0.213). Averaged, one cameo can move a player's
// season number more than a month of real basketball.

import type { PlayerGame, TeamGame } from "./fetch-season";

/**
 * Per-game PIE values beyond this are excluded from the season average.
 *
 * PIE is a player's share of the game's total events, so it lives in roughly
 * [-1, 1] — a value of -11 is not a bad night, it is a collapsed denominator.
 * Measured across all 26,638 player-games of 2025-26, exactly 12 rows exceed 2
 * in absolute value and every one is an appearance of under seven minutes
 * (Joan Beringer -11.0 in 4.8 minutes, Chris Boucher +6.0 in 3.0).
 *
 * Minute-weighting alone does not absorb them: Beringer's single -11 held his
 * season PIE below -0.85 through thirteen games. So these are dropped from the
 * PIE average specifically — not from minutes, not from the box score, and not
 * from the stored game log, which stays exactly as the API returned it. The
 * exclusion is a statement about one derived average, not an edit to the data.
 */
const PIE_SANITY_LIMIT = 2;

/** Season-to-date inputs, in the shape the scoring formula consumes. */
export type SeasonToDate = {
  gamesPlayed: number;
  teamGamesPlayed: number;
  teamWins: number;
  minutesPerGame: number;
  usageRate: number;
  pie: number;
  netRating: number;
  trueShootingPercentage: number;
  pointsPerGame: number;
  assistsPerGame: number;
  reboundsPerGame: number;
  blocksPerGame: number;
  stealsPerGame: number;
  foulsPerGame: number;
  turnoversPerGame: number;
  /** Retained for display and for asserting the aggregation is sane. */
  totalMinutes: number;
  totalPossessions: number;
};

/**
 * The team context for a player as of a date, stint-aware.
 *
 * A traded player breaks the assumption that "his team" is one thing, and the
 * formula depends on it twice — `wins / games` and
 * `availability = gamesPlayed / teamGamesPlayed`. His games accumulate across
 * both clubs, while either club's record alone is the wrong denominator: using
 * the current club's full season can produce an availability above 1.
 *
 * The season is therefore split into consecutive stints, divided at the date a
 * player first appears for a new team, and each club contributes the games it
 * played inside its own stint. Crucially the FIRST stint runs from the start of
 * the season, and the LAST runs to `upto` — the window is not bounded by his
 * own appearances.
 *
 * ── Why the window is not first-appearance to last-appearance ──────────────
 *
 * That was the original rule and it quietly deleted absence. A player who tore
 * something in October and returned for the last eighteen games had a window
 * eighteen games wide, so missing 64 games cost him nothing:
 *
 *     Jayson Tatum, 2026-04-12    16 games played, "availability" 0.89
 *     ranked 5th in the league on a season he almost entirely missed
 *
 * Anchoring to the season instead gives 16/82 = 0.195, and he places where a
 * 16-game season belongs. The availability term exists precisely to charge for
 * those games; a window drawn around a player's own appearances can never see
 * them, because it is defined by them.
 *
 * ── The one thing this over-charges ────────────────────────────────────────
 *
 * Stints are divided at the player's first game for the new club, because the
 * API's game logs carry no transaction dates. Games his old club plays between
 * the trade and his debut for the new one are therefore still charged to him.
 * That is a handful of games for a traded player, and it errs toward penalising
 * — the safe direction for a metric whose failure mode is flattering someone
 * who did not play.
 *
 * `gamesPlayed ≤ teamGamesPlayed` still holds by construction: every game he
 * played for a club falls inside that club's stint.
 */
export function teamContextAsOf(
  playerGames: PlayerGame[],
  teamGamesByTeam: Map<number, TeamGame[]>,
  upto: string,
): { teamGamesPlayed: number; teamWins: number } {
  const played = playerGames.filter((g) => g.date <= upto);
  if (played.length === 0) return { teamGamesPlayed: 0, teamWins: 0 };

  // Teams in the order he first appeared for them. `played` is already sorted
  // ascending, so first sighting is arrival.
  const order: number[] = [];
  const arrival = new Map<number, string>();
  for (const g of played) {
    if (!arrival.has(g.teamId)) {
      arrival.set(g.teamId, g.date);
      order.push(g.teamId);
    }
  }

  let teamGamesPlayed = 0;
  let teamWins = 0;

  for (let i = 0; i < order.length; i++) {
    const teamId = order[i];
    // Open at the start for the first club, so games missed in October count.
    const from = i === 0 ? "" : arrival.get(teamId)!;
    // Closed at the next club's arrival, or at `upto` for the current club, so
    // games missed at the end count too.
    const until = i + 1 < order.length ? arrival.get(order[i + 1])! : null;

    for (const tg of teamGamesByTeam.get(teamId) ?? []) {
      if (tg.date > upto) break; // sorted ascending
      if (tg.date < from) continue;
      if (until !== null && tg.date >= until) continue;
      teamGamesPlayed++;
      if (tg.won) teamWins++;
    }
  }

  return { teamGamesPlayed, teamWins };
}

/** Index team games by team, once, so the per-date loop stays cheap. */
export function indexTeamGames(teamGames: TeamGame[]): Map<number, TeamGame[]> {
  const byTeam = new Map<number, TeamGame[]>();
  for (const g of teamGames) {
    const list = byTeam.get(g.teamId) ?? [];
    list.push(g);
    byTeam.set(g.teamId, list);
  }
  for (const list of byTeam.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return byTeam;
}

/**
 * A player's season-to-date figures on a date.
 *
 * `playerGames` must be that player's games only, ascending by date. Returns
 * null before his first appearance, where there is no average to report and a
 * zero would read as a real one.
 */
export function seasonToDate(
  playerGames: PlayerGame[],
  teamGamesByTeam: Map<number, TeamGame[]>,
  upto: string,
): SeasonToDate | null {
  const games = playerGames.filter((g) => g.date <= upto);
  if (games.length === 0) return null;

  const n = games.length;

  let minutes = 0;
  let possessions = 0;
  let pieMin = 0;
  // PIE carries its own minute total, because implausible games are dropped
  // from that average alone — see PIE_SANITY_LIMIT.
  let pieMinutes = 0;
  let usgMin = 0;
  let nrPoss = 0;
  let pts = 0, ast = 0, reb = 0, blk = 0, stl = 0, pf = 0, tov = 0;
  let fga = 0, fta = 0;

  for (const g of games) {
    minutes += g.minutes;
    possessions += g.possessions;
    if (Math.abs(g.pie) <= PIE_SANITY_LIMIT) {
      pieMin += g.pie * g.minutes;
      pieMinutes += g.minutes;
    }
    usgMin += g.usageRate * g.minutes;
    nrPoss += g.netRating * g.possessions;
    pts += g.points;
    ast += g.assists;
    reb += g.rebounds;
    blk += g.blocks;
    stl += g.steals;
    pf += g.fouls;
    tov += g.turnovers;
    fga += g.fieldGoalAttempts;
    fta += g.freeThrowAttempts;
  }

  // Zero-minute games are dropped at ingestion, but a season can still total
  // zero possessions if every appearance was recorded without them. Guard
  // rather than emit Infinity, which sorts unpredictably instead of failing.
  const shootingPossessions = fga + 0.44 * fta;
  const { teamGamesPlayed, teamWins } = teamContextAsOf(playerGames, teamGamesByTeam, upto);

  return {
    gamesPlayed: n,
    teamGamesPlayed,
    teamWins,
    minutesPerGame: minutes / n,
    // Weighted by their own denominators, never averaged.
    usageRate: minutes > 0 ? usgMin / minutes : 0,
    // Denominator is pieMinutes, not minutes: dividing by the full total would
    // dilute the average toward zero in proportion to how much was excluded.
    pie: pieMinutes > 0 ? pieMin / pieMinutes : 0,
    netRating: possessions > 0 ? nrPoss / possessions : 0,
    // From season totals, so a two-shot night cannot weigh like a twenty-shot one.
    trueShootingPercentage:
      shootingPossessions > 0 ? pts / (2 * shootingPossessions) : 0,
    pointsPerGame: pts / n,
    assistsPerGame: ast / n,
    reboundsPerGame: reb / n,
    blocksPerGame: blk / n,
    stealsPerGame: stl / n,
    foulsPerGame: pf / n,
    turnoversPerGame: tov / n,
    totalMinutes: minutes,
    totalPossessions: possessions,
  };
}

/** Group games by player, ascending by date — the shape `seasonToDate` wants. */
export function indexPlayerGames(games: PlayerGame[]): Map<number, PlayerGame[]> {
  const byPlayer = new Map<number, PlayerGame[]>();
  for (const g of games) {
    const list = byPlayer.get(g.playerId) ?? [];
    list.push(g);
    byPlayer.set(g.playerId, list);
  }
  for (const list of byPlayer.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return byPlayer;
}

/** Every date on which at least one game was played, ascending. */
export function gameDates(games: PlayerGame[]): string[] {
  return [...new Set(games.map((g) => g.date))].sort();
}
