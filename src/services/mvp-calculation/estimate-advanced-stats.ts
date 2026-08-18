// Estimating VORP, Win Shares and Box Plus/Minus for a day that was not scraped.
//
// Every other input the formula needs can be reconstructed exactly for any past
// date from Basketball Reference game logs: games played, the team's record,
// every per-game box-score rate, true shooting, and usage. These three cannot.
// They depend on league-wide context — pace, league average efficiency, team
// ratings — which Basketball Reference computes across all thirty teams and
// publishes only as a current snapshot. Yesterday's values are gone.
//
// So they are interpolated between the two real observations either side of the
// gap. This is not the same problem as reconstructing a season from its final
// totals, which is hindsight bias and worst early in the year. Every gap in this
// dataset is bounded on both sides by a scrape that actually happened, seven of
// the eight runs are a single day wide, and the interpolation is anchored to a
// quantity known exactly for every missing day.
//
// ── Why the anchor is games played, not the calendar ────────────────────────
//
// VORP and Win Shares are cumulative: they accrue per game a player appears in,
// not per day that passes. Interpolating on dates would drift them forward for
// a player who sat out the entire gap, inventing production during an absence —
// which is precisely the error this project spent a formula revision removing.
//
// Anchoring on games played gives the right behaviour for free: a player who
// did not play has a weight of zero and his figures are held flat.
//
// Box plus/minus is a rate rather than a total, but it is a season-to-date rate
// and moves only when a player plays, so it takes the same weight.
//
// Anything produced here must be stored with `estimated: true`. A reader cannot
// tell an interpolated row from a measured one by looking at the numbers, so the
// data has to say so.

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
