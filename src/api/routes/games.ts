// One game, assembled for the profile's Game view.
//
//   GET /games/:gameId
//   GET /games/last?player=Nikola%20Jokic&date=4-12-2026
//
// ── Where a game's numbers come from ───────────────────────────────────────
//
// Two collections, each authoritative for different things:
//
//   PlayerGameLogs2526   every player's line, for both teams, keyed by gameId.
//                        The box score is a query, not a join — both sides are
//                        already in there.
//   GameSummaries2526    the scoreboard: quarter scores, which side was home,
//                        and whether the game was played at a neutral site.
//
// The final score is *derived* by summing each side's player points rather than
// read from the summary. Both agree on all 1,230 games (see `pnpm verify-games`),
// and deriving it means the header score and the box score beneath it cannot
// disagree — they are the same numbers added up the same way.
//
// Home/away comes from the summary, never from the log row's `isHome`. On a
// neutral-site game — the NBA Cup games in Las Vegas — both teams' MATCHUP
// strings read "@" and neither is hosting.

import { Router } from "express";
import logger from "../../utils/logger";
import { getDb } from "../../database/database";
import { toDateKey, parseDateKey } from "../../utils/date-key";

const gamesRouter = Router();

const LOGS = "PlayerGameLogs2526";
const SUMMARIES = "GameSummaries2526";
const HIGHLIGHTS = "PlayerGameHighlights";

/** A shooting line as the box score prints it: "8-23". */
const line = (made: number, attempted: number) => `${made}-${attempted}`;

/**
 * "M-D-YYYY" → "YYYY-MM-DD", the form the game log stores dates in.
 *
 * Formatted from the local parts rather than through `toISOString()`.
 * `parseDateKey` builds its Date at local midnight, and `toISOString` converts
 * to UTC — which for anyone east of Greenwich moves that midnight back into the
 * previous day and silently queries the wrong date. The same trap is documented
 * in build-season.ts, in the other direction.
 */
function isoFromDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type BoxRow = {
  playerId: number;
  player: string;
  teamId: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoals: string;
  threes: string;
  freeThrows: string;
  plusMinus: number;
};

const toBoxRow = (r: any): BoxRow => ({
  playerId: r.playerId,
  player: r.playerName,
  teamId: r.teamId,
  minutes: r.minutes,
  points: r.points,
  rebounds: r.rebounds,
  assists: r.assists,
  steals: r.steals,
  blocks: r.blocks,
  turnovers: r.turnovers,
  fieldGoals: line(r.fieldGoalsMade, r.fieldGoalAttempts),
  threes: line(r.threesMade, r.threeAttempts),
  freeThrows: line(r.freeThrowsMade, r.freeThrowAttempts),
  plusMinus: r.plusMinus,
});

/**
 * Build the response for one game, from the perspective of one player.
 *
 * "Perspective" is the whole shape of this: `team`/`opponent`, `teamScore`/
 * `opponentScore` and `win` are all relative to the player whose profile is
 * open. The same game viewed from the other roster is a different object, which
 * is why this takes a playerId rather than returning a neutral game record.
 */
async function assembleGame(db: any, gameId: string, playerId: number, upToIso?: string) {
  const rows = await db.collection(LOGS).find({ gameId }).toArray();
  if (rows.length === 0) return null;

  const self = rows.find((r: any) => r.playerId === playerId);
  if (!self) return null;

  const summary = await db.collection(SUMMARIES).findOne({ gameId });

  const teamId = self.teamId;
  const opponentId = rows.find((r: any) => r.teamId !== teamId)?.teamId ?? null;
  const ours = rows.filter((r: any) => r.teamId === teamId);
  const theirs = rows.filter((r: any) => r.teamId !== teamId);

  const teamScore = ours.reduce((a: number, r: any) => a + r.points, 0);
  const opponentScore = theirs.reduce((a: number, r: any) => a + r.points, 0);

  const isHome = summary ? teamId === summary.homeTeamId : self.isHome;
  const quarters = summary
    ? {
        team: isHome ? summary.homePeriods : summary.awayPeriods,
        opponent: isHome ? summary.awayPeriods : summary.homePeriods,
      }
    : { team: [], opponent: [] };

  const highlight = await db.collection(HIGHLIGHTS).findOne({ gameId });

  // Position in this player's own season — "Game 60 of 60" — from an indexed
  // count rather than by loading the season.
  //
  // The neighbours come from the same index. `upToIso` bounds the forward step
  // to the date being viewed: on a January board, stepping "next" out to April
  // would leave the game panel describing a game the rest of the page has not
  // reached.
  const [number, of, prev, next] = await Promise.all([
    db.collection(LOGS).countDocuments({ playerId, date: { $lte: self.date } }),
    db.collection(LOGS).countDocuments({ playerId }),
    db.collection(LOGS)
      .find({ playerId, date: { $lt: self.date } })
      .sort({ date: -1 })
      .limit(1)
      .next(),
    db.collection(LOGS)
      .find({
        playerId,
        date: upToIso ? { $gt: self.date, $lte: upToIso } : { $gt: self.date },
      })
      .sort({ date: 1 })
      .limit(1)
      .next(),
  ]);

  return {
    gameId,
    date: toDateKey(new Date(`${self.date}T12:00:00`)),
    isoDate: self.date,
    team: self.teamAbbr,
    teamId,
    opponent: theirs[0]?.teamAbbr ?? self.opponentAbbr,
    opponentTeamId: opponentId,
    home: isHome,
    neutralSite: summary?.neutralSite ?? false,
    teamScore,
    opponentScore,
    win: teamScore > opponentScore,
    overtime: summary ? summary.overtimePeriods > 0 : false,
    overtimePeriods: summary?.overtimePeriods ?? 0,
    quarters,
    line: {
      minutes: self.minutes,
      points: self.points,
      rebounds: self.rebounds,
      assists: self.assists,
      steals: self.steals,
      blocks: self.blocks,
      turnovers: self.turnovers,
      fieldGoals: line(self.fieldGoalsMade, self.fieldGoalAttempts),
      threes: line(self.threesMade, self.threeAttempts),
      freeThrows: line(self.freeThrowsMade, self.freeThrowAttempts),
      trueShooting: self.trueShootingPercentage,
      plusMinus: self.plusMinus,
    },
    // The tracked player first, then both rosters by minutes. The UI pins him
    // anyway, but ordering here means it does not have to re-sort to find him.
    box: [
      toBoxRow(self),
      ...[...ours, ...theirs]
        .filter((r: any) => r.playerId !== playerId)
        .sort((a: any, b: any) => b.minutes - a.minutes)
        .map(toBoxRow),
    ],
    highlight: highlight?.videoId
      ? {
          videoId: highlight.videoId,
          title: highlight.title,
          channel: highlight.channel,
          durationLabel: highlight.durationLabel,
        }
      : null,
    number,
    of,
    prevGameId: prev?.gameId ?? null,
    nextGameId: next?.gameId ?? null,
  };
}

/**
 * The most recent game a player played on or before a date.
 *
 * `?date=` is the same "M-D-YYYY" key the rest of the app queries by, and it is
 * required rather than defaulting to the end of the season: a chip on a November
 * board that reported an April game would be the same class of error as the rank
 * bug this project already fixed once.
 */
gamesRouter.get("/last", async (req, res) => {
  const playerName = typeof req.query.player === "string" ? req.query.player : null;
  const dateKey = typeof req.query.date === "string" ? req.query.date : null;

  if (!playerName || !dateKey) {
    res.status(400).json({ message: "Both ?player= and ?date= are required." });
    return;
  }
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    res.status(400).json({ message: `Unparseable date "${dateKey}". Expected M-D-YYYY.` });
    return;
  }

  try {
    const db = await getDb();
    const iso = isoFromDateKey(parsed);

    const last = await db
      .collection(LOGS)
      .find({ playerName, date: { $lte: iso } })
      .sort({ date: -1 })
      .limit(1)
      .next();

    if (!last) {
      res.status(404).json({
        message: `No game for ${playerName} on or before ${dateKey}. Either the player is unknown or he had not debuted.`,
      });
      return;
    }

    const game = await assembleGame(db, last.gameId, last.playerId, iso);
    if (!game) {
      res.status(404).json({ message: `Could not assemble game ${last.gameId}.` });
      return;
    }
    res.json(game);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

// GET /games/:gameId?player=<name> — one specific game, for prev/next stepping
// and deep links. The player is needed because the response is relative to him.
gamesRouter.get("/:gameId", async (req, res) => {
  const gameId = req.params.gameId;
  const playerName = typeof req.query.player === "string" ? req.query.player : null;
  const dateKey = typeof req.query.date === "string" ? req.query.date : null;
  const upTo = dateKey ? parseDateKey(dateKey) : null;

  if (!playerName) {
    res.status(400).json({ message: "?player= is required — a game is reported from one roster's side." });
    return;
  }

  try {
    const db = await getDb();
    const row = await db.collection(LOGS).findOne({ gameId, playerName });
    if (!row) {
      res.status(404).json({ message: `${playerName} has no row in game ${gameId}.` });
      return;
    }

    const game = await assembleGame(db, gameId, row.playerId, upTo ? isoFromDateKey(upTo) : undefined);
    if (!game) {
      res.status(404).json({ message: `No game ${gameId}.` });
      return;
    }
    res.json(game);
  } catch (err) {
    logger.error(err);
    res.status(500).send("Server error");
  }
});

export default gamesRouter;
