// export schemas here
export interface FullPlayerSummary {
  player: string;
  profileUrl: string; // <-- stored from the table link
  team: string;
  teamWins: number;
  teamGamesPlayed: number;
  gamesStarted: number;
  minutesPerGame: number;
  pointsPerGame: number;
  assistsPerGame: number;
  reboundsPerGame: number;
  blocksPerGame: number;
  stealsPerGame: number;
  foulsPerGame: number;
  turnoversPerGame: number;
  usageRate: number;
  valueOverReplacement: number;
  winShare: number;
  boxPlusMinus: number;
  trueShootingPercentage: number;
}

export interface PlayerWithCalculatedMvpValue extends FullPlayerSummary {
  mvpValue: number;
  calculatedRank: number;
}

export interface PlayerMvpSummary {
  websiteRanking: string;
  player: string;
  profileUrl: string; // <-- stored from the table link
  teamWins: number;
  teamGamesPlayed: number;
  gamesStarted: number;
  minutesPerGame: number;
  pointsPerGame: number;
  assistsPerGame: number;
  reboundsPerGame: number;
  blocksPerGame: number;
  stealsPerGame: number;
  foulsPerGame: number;
  turnoversPerGame: number;
}

export interface PpgPlayerSummary {
  player: string;
  profileUrl: string;
  pointsPerGame: number;
}
