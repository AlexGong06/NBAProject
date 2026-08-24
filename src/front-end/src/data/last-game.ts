// Labels for the last-game chip.
//
// Pure functions, kept out of the component so they can be tested: the vitest
// config excludes `src/front-end/src/components/**` on the grounds that nothing
// there is testable without a DOM, and date arithmetic very much is.

import type { LastGame } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "M-D-YYYY" → a Date at local noon.
 *
 * Noon, not midnight. A date built at midnight sits one hour from a daylight
 *-saving boundary twice a year, and the season crosses one in March — enough to
 * turn a difference of exactly N days into N ± 1 after rounding.
 */
function fromDateKey(key: string): Date | null {
  const parts = key.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [m, d, y] = parts;
  if (!m || !d || !y) return null;
  return new Date(y, m - 1, d, 12);
}

/** "12-29-2025" → "Dec 29" */
export function shortDate(key: string): string {
  const d = fromDateKey(key);
  return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : key;
}

/**
 * How long before the viewed date the game was played.
 *
 * Measured from the date on screen, never from now. Jokić missed twelve
 * straight Denver games after 29 December, so on a 20 January board his chip is
 * three weeks old and has to say so — otherwise it reads as last night's
 * result. Measuring from today would also date the same game differently
 * depending on when the page was opened.
 */
export function daysBeforeLabel(gameKey: string, viewedKey: string): string {
  const game = fromDateKey(gameKey);
  const viewed = fromDateKey(viewedKey);
  if (!game || !viewed) return "";

  const days = Math.round((viewed.getTime() - game.getTime()) / 86_400_000);
  if (days <= 0) return "That night";
  if (days === 1) return "Yesterday";
  return `${days} days earlier`;
}

/**
 * `@ PHX`, `vs BOS`, or `N` for a neutral site.
 *
 * Five games in 2025-26 were played where neither team hosted — the NBA Cup
 * games in Las Vegas among them. Calling one of those "@" or "vs" would be a
 * small confident lie, so they get their own marker.
 */
export function venueLabel(game: Pick<LastGame, "home" | "neutralSite">): string {
  if (game.neutralSite) return "N";
  return game.home ? "vs" : "@";
}

/** "128–125" or "128–125 OT". An en dash, matching the rest of the UI. */
export function scoreline(game: Pick<LastGame, "teamScore" | "opponentScore" | "overtime">): string {
  return `${game.teamScore}–${game.opponentScore}${game.overtime ? " OT" : ""}`;
}
