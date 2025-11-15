// export schemas here
export interface PlayerSummary {
  rank: string;
  player: string;
  profileUrl: string;  // <-- stored from the table link
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

  // Will be filled after navigating to profile pages:
  usageRate: number | null;
  valueOverReplacement: number | null;
  winShare: number | null;
  boxPlusMinus: number | null;
  trueShootingPercentage: number | null;
}

export interface PlayerWithValue extends PlayerSummary {
  mvpValue: number;
}