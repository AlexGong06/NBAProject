// Team logos, keyed by the NBA's team id.
//
//   https://cdn.nba.com/logos/nba/1610612743/primary/L/logo.svg
//
// Same arrangement as headshot.ts: the id is already on every row, the CDN
// serves the mark, nothing is downloaded or stored. These are small SVGs —
// 2.5-9 KB each, and there are only thirty of them, so a board full of logos
// costs less than one headshot.
//
// ── Why team id and not the abbreviation ───────────────────────────────────
//
// `teams.ts` carried Basketball-Reference abbreviations (`BRK`, `CHO`, `PHO`)
// long after the data moved to the NBA API, which sends `BKN`, `CHA`, `PHX`.
// Keying anything off the abbreviation means three teams silently resolve to
// nothing. The team id has no such history: it is a stable number, it is on
// every stored row, and it is what the CDN path wants anyway.

/**
 * Team ids are ten digits beginning 16106127xx. Anything else is a caller
 * passing something that is not a team id, and building a URL from it would
 * produce a 404 the UI then has to recover from.
 */
export function teamLogoUrl(teamId: number | null | undefined): string | null {
  if (typeof teamId !== "number" || !Number.isInteger(teamId) || teamId <= 0) {
    return null;
  }
  return `https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg`;
}
