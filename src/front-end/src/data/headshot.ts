// Player headshots, derived from data the rows already carry.
//
// The NBA serves every player's photo from a predictable path keyed by player
// id, so nothing needs to be downloaded, stored or proxied — the id is enough:
//
//   https://cdn.nba.com/headshots/nba/latest/260x190/1626166.png
//
// ── Why two fields ─────────────────────────────────────────────────────────
//
// The id reaches the front end by two different routes. The API projects
// `playerId` directly (see the projection in api/routes/players.ts). The
// committed fixture drops it — `scripts/generate-fixture.ts` treats ids as an
// ingestion concern — but keeps `profileUrl`, which embeds the same id in its
// path. Reading whichever is present is what lets headshots work offline
// against the fixture without regenerating it.

/** `https://www.nba.com/player/1628983/shai-gilgeous-alexander` → 1628983 */
const ID_IN_PROFILE_URL = /\/player\/(\d+)/;

/**
 * The size to request.
 *
 * Every avatar in the app is a circle of 132px or less, and the 1040x760
 * variant is ~200 KB against ~15 KB for this one. On a board of 50 rows that
 * difference is the whole page weight.
 */
const SIZE = "260x190";

export function playerIdOf(row: {
  playerId?: number;
  profileUrl?: string;
}): number | null {
  if (typeof row.playerId === "number" && Number.isInteger(row.playerId) && row.playerId > 0) {
    return row.playerId;
  }

  const matched = row.profileUrl?.match(ID_IN_PROFILE_URL)?.[1];
  if (!matched) return null;

  const id = Number(matched);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The headshot URL for a row, or null when no id can be recovered.
 *
 * Null rather than a placeholder image: the caller already renders the player's
 * initials, and falling back to those reads better than a generic silhouette.
 */
export function headshotUrl(row: {
  playerId?: number;
  profileUrl?: string;
}): string | null {
  const id = playerIdOf(row);
  return id === null ? null : `https://cdn.nba.com/headshots/nba/latest/${SIZE}/${id}.png`;
}
