// Reading an NBA highlight video's title back into a game.
//
// There is no shared identifier between YouTube and the NBA's `gameId`, so the
// join is the title: two teams and a date. Workable because the videos come
// from one curated playlist where the format barely varies:
//
//   NUGGETS at WARRIORS | FULL GAME HIGHLIGHTS | October 23, 2025
//   THUNDER at KINGS | EMIRATES NBA CUP 🏆 | FULL GAME HIGHLIGHTS | November 7, 2025
//
// This parses 1,218 of the season's 1,230 games; the twelve it misses have no
// reel on the playlist at all.
//
// **The date in the title is the game date, not the upload date** — a game on
// the 13th appears in a video published on the 14th. Allowing a ±1 day slip
// when matching found zero additional games, and date fuzzing is exactly how a
// doubleheader gets matched to the wrong night.

/** Uppercase nickname as the titles write it → the abbreviation we store. */
const NICKNAMES: Record<string, string> = {
  HAWKS: "ATL",
  NETS: "BKN",
  CELTICS: "BOS",
  HORNETS: "CHA",
  BULLS: "CHI",
  CAVALIERS: "CLE",
  MAVERICKS: "DAL",
  NUGGETS: "DEN",
  PISTONS: "DET",
  WARRIORS: "GSW",
  ROCKETS: "HOU",
  PACERS: "IND",
  CLIPPERS: "LAC",
  LAKERS: "LAL",
  GRIZZLIES: "MEM",
  HEAT: "MIA",
  BUCKS: "MIL",
  TIMBERWOLVES: "MIN",
  PELICANS: "NOP",
  KNICKS: "NYK",
  THUNDER: "OKC",
  MAGIC: "ORL",
  "76ERS": "PHI",
  SUNS: "PHX",
  "TRAIL BLAZERS": "POR",
  KINGS: "SAC",
  SPURS: "SAS",
  RAPTORS: "TOR",
  JAZZ: "UTA",
  WIZARDS: "WAS",

  // Typos in the NBA's own titles, found by running this over the season. Both
  // are single videos, and both are the only reel for their game — dropping
  // them to punish a spelling mistake would lose real footage.
  GRIZZLES: "MEM",
  "TRAIL BLAZZERS": "POR",
};

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

/**
 * `AWAY at HOME | [event tag |] FULL GAME HIGHLIGHTS | Month D, YYYY`
 *
 * The optional middle segment is the one deliberate looseness. 66 NBA Cup group
 * games — which count in the standings, and are therefore in our season — carry
 * a sponsor tag there:
 *
 *   THUNDER at KINGS | EMIRATES NBA CUP 🏆 | FULL GAME HIGHLIGHTS | November 7, 2025
 *
 * Requiring the strict two-pipe form instead would drop those 66 plus a handful
 * of Play-In and international games: 93.7% coverage against 99.0%. The literal
 * `FULL GAME HIGHLIGHTS` is still required, so this stays a full-game reel and
 * not a top-10 compilation.
 */
const TITLE = /^([A-Z0-9 ]+?)\s+at\s+([A-Z0-9 ]+?)\s*\|(?:[^|]*\|)?\s*FULL GAME HIGHLIGHTS\s*\|\s*([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})$/;

export type ParsedTitle = {
  awayAbbr: string;
  homeAbbr: string;
  /** "YYYY-MM-DD", matching how game dates are stored. */
  isoDate: string;
};

/**
 * Read a video title into the game it covers, or null.
 *
 * Null for anything that is not a standard full-game reel: player mixes, weekly
 * round-ups, and the `EXTENDED:` re-cuts. Returning null rather than a
 * best-effort guess is the point — an unparsed title costs one game its video,
 * while a wrong parse shows the wrong game under the right scoreline.
 */
export function parseHighlightTitle(raw: string | null | undefined): ParsedTitle | null {
  if (!raw) return null;

  let title = raw.replace(/\s+/g, " ").trim();

  // A longer re-cut of a game that already has a standard reel. Excluded on
  // purpose rather than missed.
  if (/^EXTENDED\s*:/i.test(title)) return null;

  title = title.replace(/\s*\((?:edited|re-?upload)\)\s*$/i, "");

  const m = title.match(TITLE);
  if (!m) return null;

  const awayAbbr = NICKNAMES[m[1].trim().toUpperCase()];
  const homeAbbr = NICKNAMES[m[2].trim().toUpperCase()];
  const month = MONTHS[m[3]];
  const day = Number(m[4]);
  const year = Number(m[5]);

  if (!awayAbbr || !homeAbbr || !month || !day || !year) return null;
  if (awayAbbr === homeAbbr) return null;

  return {
    awayAbbr,
    homeAbbr,
    isoDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

/**
 * ISO-8601 duration → the label the player's footer shows.
 *
 *   PT8M12S    → "8:12"
 *   PT1H2M3S   → "1:02:03"
 *   PT45S      → "0:45"
 */
export function formatDuration(iso: string | null | undefined): string {
  const m = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return "";

  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const pad = (n: number) => String(n).padStart(2, "0");

  return h > 0 ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}
