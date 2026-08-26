// Estimating VORP, Win Shares and Box Plus/Minus for a day that was not scraped.
//
// Legacy: these three metrics left the formula at version 3. Retained for
// `pnpm validate-estimates`, which checks the old interpolated rows.
//
// They depend on league-wide context that Basketball Reference publishes only
// as a current snapshot, so a past date's values cannot be re-read — they are
// interpolated between the real observations either side of the gap.
//
// **The anchor is games played, not the calendar.** VORP and Win Shares accrue
// per game appeared in, so interpolating on dates would drift them forward for
// a player who sat out the whole gap — inventing production during an absence.
// Anchored on games, a player who did not play has weight zero and holds flat.
//
// Anything produced here is stored with `estimated: true`: an interpolated row
// is indistinguishable from a measured one by its numbers alone.

/** A real observation either side of a gap. */
export type AdvancedAnchor = {
  /** Games the player had appeared in when this was recorded. */
  gamesPlayed: number;
  valueOverReplacement: number;
  winShare: number;
  boxPlusMinus: number;
};

export type AdvancedEstimate = {
  valueOverReplacement: number;
  winShare: number;
  boxPlusMinus: number;
  /**
   * Share of the gap's games that had been played at the estimated point, 0..1.
   * Zero means the player did not appear between the anchors and the earlier
   * figures were carried forward unchanged.
   */
  weight: number;
};

/**
 * Interpolate the three league-context stats at a point between two real
 * observations.
 *
 * Throws rather than extrapolating: a point outside the anchors is not
 * something this can answer, and guessing would be indistinguishable from an
 * answer once it is written to the database.
 */
export function interpolateAdvanced(
  before: AdvancedAnchor,
  after: AdvancedAnchor,
  gamesPlayedAt: number,
): AdvancedEstimate {
  if (after.gamesPlayed < before.gamesPlayed) {
    throw new Error(
      `Anchors are out of order: before has ${before.gamesPlayed} games played, ` +
        `after has ${after.gamesPlayed}.`,
    );
  }
  if (gamesPlayedAt < before.gamesPlayed || gamesPlayedAt > after.gamesPlayed) {
    throw new Error(
      `${gamesPlayedAt} games played is outside the anchors ` +
        `[${before.gamesPlayed}, ${after.gamesPlayed}] — that is extrapolation, ` +
        `not interpolation.`,
    );
  }

  const span = after.gamesPlayed - before.gamesPlayed;

  // The player did not appear between the two observations, so nothing accrued
  // and no rate could have moved. Carry the earlier figures forward exactly.
  const weight = span === 0 ? 0 : (gamesPlayedAt - before.gamesPlayed) / span;

  const at = (a: number, b: number) => a + (b - a) * weight;

  return {
    valueOverReplacement: at(before.valueOverReplacement, after.valueOverReplacement),
    winShare: at(before.winShare, after.winShare),
    boxPlusMinus: at(before.boxPlusMinus, after.boxPlusMinus),
    weight,
  };
}

/** The fields this module estimates, for stamping provenance onto a row. */
export const ESTIMATED_FIELDS = [
  "valueOverReplacement",
  "winShare",
  "boxPlusMinus",
] as const;
