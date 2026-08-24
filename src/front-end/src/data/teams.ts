// Team abbreviation to full name. Static reference data — the stored rows carry
// only the abbreviation, and this is the one place that expands it.
//
// ── These are NBA API codes, not Basketball-Reference ones ─────────────────
//
// Brooklyn, Charlotte and Phoenix are the three teams the two sources spell
// differently: `BKN`/`CHA`/`PHX` here against `BRK`/`CHO`/`PHO` at Basketball
// Reference. This map kept the old spellings for several phases after the data
// moved, so those three teams rendered a bare "BKN" where every other team
// showed its full name — a lookup miss that degraded quietly enough that nobody
// noticed.
//
// Anything keyed by team identity should prefer `teamId`, which has no such
// history. See data/team-logo.ts.

export const TEAMS: Record<string, string> = {
  ATL: "Atlanta Hawks",
  BKN: "Brooklyn Nets",
  BOS: "Boston Celtics",
  CHA: "Charlotte Hornets",
  CHI: "Chicago Bulls",
  CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks",
  DEN: "Denver Nuggets",
  DET: "Detroit Pistons",
  GSW: "Golden State Warriors",
  HOU: "Houston Rockets",
  IND: "Indiana Pacers",
  LAC: "Los Angeles Clippers",
  LAL: "Los Angeles Lakers",
  MEM: "Memphis Grizzlies",
  MIA: "Miami Heat",
  MIL: "Milwaukee Bucks",
  MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans",
  NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder",
  ORL: "Orlando Magic",
  PHI: "Philadelphia 76ers",
  PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers",
  SAC: "Sacramento Kings",
  SAS: "San Antonio Spurs",
  TOR: "Toronto Raptors",
  UTA: "Utah Jazz",
  WAS: "Washington Wizards",
};
