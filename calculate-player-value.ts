// Total Value = 0.5(Win Contribution) + 0.5(Total Stats)
// Win Contribution = Level of Impact * Quality of Impact
// Level of Impact = (Team Wins * Games Played/Total Games * Minutes Per Game/48 * Usage Rate/100)
// Quality of Impact = 0.4(VORP + Win Share) + 0.2(Box Plus Minus)
// Total Stats = (Points * True Shooting % * 1.5(Assists) + 1.2(Rebounds) + 3(Blocks) + 3(Steals) - Fouls - Turnovers) / 25
// Link to the top 10 MVP candidates: https://www.basketball-reference.com/friv/mvp.html

import { PlayerSummary, PlayerWithValue } from "./types";

/* 
    playerObject = {
        player: "Steph Curry",
        rank: 1,
        teamWins: 9, // on mvp tracker page
        teamGamesPlayed: 10, // on mvp tracker page
        gamesStarted: 10, // on mvp tracker page
        minutesPerGame: 32, // on mvp tracker page
        usageRate: 28.4,
        valueOverReplacement: 4.3,
        winShare: 8.1,
        boxPlusMinus: 18,
        pointsPerGame: 29.4, // on mvp tracker page
        trueShootingPercentage: 0.634,
        assistsPerGame: 5.8, // on mvp tracker page
        reboundsPerGame: 4.5, // on mvp tracker page
        blocksPerGame: 0.3, // on mvp tracker page
        stealsPerGame: 0.5, // on mvp tracker page
        foulsPerGame: 2.6, // on mvp tracker page
        turnoversPerGame: 1.3 // on mvp tracker page
    }
*/


function calculatePlayerValue(player: PlayerSummary): number {
  // ---- Level of Impact Components ----
  console.log(`calculating mvp value for: ${player.player}`)
  const teamWinRatio =
    player.teamGamesPlayed > 0
      ? player.teamWins / player.teamGamesPlayed
      : 0;

  const minutesFactor = player.minutesPerGame / 48;

  const usageFactor =
    player.usageRate !== null ? player.usageRate / 100 : 0;

  const levelOfImpact =
    teamWinRatio * minutesFactor * usageFactor;

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
  console.log(`mvp value: ${totalValue}`)
  return totalValue;
}


export function calculateAllPlayerValues(players: PlayerSummary[]): PlayerWithValue[] {
  return players
    .map(player => {
      const mvpValue = calculatePlayerValue(player);
      return {
        ...player,
        mvpValue
      };
    })
    .sort((a, b) => b.mvpValue - a.mvpValue); // highest value first
}

