// Total Value = Availability * (0.5(Win Contribution) + 0.5(Total Stats))
// Availability = Player Games / Team Games
// Win Contribution = Level of Impact * Quality of Impact
// Level of Impact = (Team Wins/Team Games) * (Minutes Per Game/48) * (Usage Rate/100)
// Quality of Impact = 0.4(VORP + Win Share) + 0.2(Box Plus Minus)
// Total Stats = (Points * True Shooting % + 1.5(Assists) + 1.2(Rebounds) + 3(Blocks) + 3(Steals) - Fouls - Turnovers) / 25
// Link to the top 10 MVP candidates: https://www.basketball-reference.com/friv/mvp.html
//
// Availability multiplies the WHOLE score rather than sitting inside Level of
// Impact, and that placement is the entire point.
//
// Total Stats is built from per-game rates, so it cannot tell a player who
// appeared 25 times from one who appeared 55. It is also the larger half of the
// score. Leaving it untouched meant a player available for 45% of his team's
// games still scored 72% of an ever-present peer — less of a penalty than
// simply pro-rating him. Applying availability at the top brings that to 38%.
//
// So absence is penalised twice, deliberately: VORP and Win Shares are
// cumulative and already stop accruing while a player sits, and availability
// compounds that. The result is harsher than proportional, which is how MVP
// voting actually treats missed games.

import logger from "../../utils/logger";
import {
  CURRENT_FORMULA_VERSION,
  PlayerWithCalculatedMvpValueSchema,
} from "../../utils/types";
// Type-only, so this file can be pulled into the front end's program (which
// runs with verbatimModuleSyntax) without dragging Zod in as a value import.
import type {
  FullPlayerSummary,
  PlayerWithCalculatedMvpValue,
} from "../../utils/types";

// Exported for tests: the scoring rule is the product this repo exists to
// produce, and it should be assertable without going through ranking.
export function calculatePlayerValue(player: FullPlayerSummary): number {
  // ---- Level of Impact Components ----
  logger.info(`calculating mvp value for ${player.player}`);
  const teamWinRatio =
    player.teamGamesPlayed > 0 ? player.teamWins / player.teamGamesPlayed : 0;

  // Share of his team's games the player was actually available for. Guarded
  // the same way as the win ratio: a team with no games played yet must not
  // produce NaN, because NaN comparisons are all false and the ranking sort
  // would silently stop sorting rather than visibly break.
  const availability =
    player.teamGamesPlayed > 0 ? player.gamesPlayed / player.teamGamesPlayed : 0;

  const minutesFactor = player.minutesPerGame / 48;

  const usageFactor = player.usageRate !== null ? player.usageRate / 100 : 0;

  const levelOfImpact = teamWinRatio * minutesFactor * usageFactor;

  // ---- Quality of Impact ----

  const qualityOfImpact =
    0.4 * ((player.valueOverReplacement || 0) + (player.winShare || 0)) +
    0.2 * (player.boxPlusMinus || 0);

  // ---- Win Contribution ----

  const winContribution = levelOfImpact * qualityOfImpact;

  // ---- Total Stats ----

  const totalStats =
    (player.pointsPerGame * (player.trueShootingPercentage || 0) +
      1.5 * player.assistsPerGame +
      1.2 * player.reboundsPerGame +
      3 * player.blocksPerGame +
      3 * player.stealsPerGame -
      player.foulsPerGame -
      player.turnoversPerGame) /
    25;

  // ---- Final Total Value ----

  const totalValue = availability * (0.5 * winContribution + 0.5 * totalStats);
  logger.info(`mvp value: ${totalValue}`);
  return totalValue;
}

export function calculateAllPlayerValues(
  players: FullPlayerSummary[],
): PlayerWithCalculatedMvpValue[] {
  const sortedPlayers = players
    .map((player) => {
      const mvpValue = calculatePlayerValue(player);
      return {
        ...player,
        mvpValue,
      };
    })
    .sort((a, b) => b.mvpValue - a.mvpValue); // highest value first

  const finalArray: PlayerWithCalculatedMvpValue[] = [];

  // 3. Assign calculatedRank
  sortedPlayers.forEach((player, index) => {
    const ranked = {
      ...player,
      calculatedRank: index + 1,
      formulaVersion: CURRENT_FORMULA_VERSION,
    };

    const validated = PlayerWithCalculatedMvpValueSchema.safeParse(ranked);

    if (!validated.success) {
      logger.error(`Output validation failed for player ${player.player}:`);
      logger.error(validated.error.format());
      throw new Error(
        `Invalid PlayerWithCalculatedMvpValue for ${player.player}`,
      );
    }

    finalArray.push(validated.data);
  });

  return finalArray;
}
