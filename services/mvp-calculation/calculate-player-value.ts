// Total Value = 0.5(Win Contribution) + 0.5(Total Stats)
// Win Contribution = Level of Impact * Quality of Impact
// Level of Impact = (Team Wins * Games Played/Total Games * Minutes Per Game/48 * Usage Rate/100)
// Quality of Impact = 0.4(VORP + Win Share) + 0.2(Box Plus Minus)
// Total Stats = (Points * True Shooting % * 1.5(Assists) + 1.2(Rebounds) + 3(Blocks) + 3(Steals) - Fouls - Turnovers) / 25
// Link to the top 10 MVP candidates: https://www.basketball-reference.com/friv/mvp.html

import logger from "../../utils/logger";
import {
  FullPlayerSummary,
  PlayerWithCalculatedMvpValue,
} from "../../utils/types";

function calculatePlayerValue(player: FullPlayerSummary): number {
  // ---- Level of Impact Components ----
  logger.info(`calculating mvp value for ${player.player}`);
  const teamWinRatio =
    player.teamGamesPlayed > 0 ? player.teamWins / player.teamGamesPlayed : 0;

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

  const totalValue = 0.5 * winContribution + 0.5 * totalStats;
  logger.info(`mvp value: ${totalValue}`);
  return totalValue;
}

export function calculateAllPlayerValues(
  players: FullPlayerSummary[]
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
    finalArray.push({ ...player, calculatedRank: index + 1 });
  });

  return finalArray;
}
