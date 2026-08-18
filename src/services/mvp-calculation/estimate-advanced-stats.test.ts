// Tests for the advanced-stat interpolation.
//
// These numbers get written to the database and are indistinguishable from
// measured ones once stored, so the properties that keep them honest — never
// extrapolating, never drifting a player who did not play — are asserted
// directly rather than left to the caller.

import { describe, expect, it } from "vitest";
import {
  interpolateAdvanced,
  type AdvancedAnchor,
} from "./estimate-advanced-stats";

const before: AdvancedAnchor = {
  gamesPlayed: 40,
  valueOverReplacement: 4.0,
  winShare: 8.0,
  boxPlusMinus: 10.0,
};
const after: AdvancedAnchor = {
  gamesPlayed: 44,
  valueOverReplacement: 4.4,
  winShare: 8.8,
  boxPlusMinus: 11.0,
};

describe("interpolateAdvanced", () => {
  it("returns the earlier anchor exactly at its own point", () => {
    const e = interpolateAdvanced(before, after, 40);
    expect(e.valueOverReplacement).toBeCloseTo(4.0, 12);
    expect(e.winShare).toBeCloseTo(8.0, 12);
    expect(e.boxPlusMinus).toBeCloseTo(10.0, 12);
    expect(e.weight).toBe(0);
  });

  it("returns the later anchor exactly at its own point", () => {
    const e = interpolateAdvanced(before, after, 44);
    expect(e.valueOverReplacement).toBeCloseTo(4.4, 12);
    expect(e.weight).toBe(1);
  });

  it("moves proportionally to games played", () => {
    const e = interpolateAdvanced(before, after, 42); // half the games
    expect(e.weight).toBeCloseTo(0.5, 12);
    expect(e.valueOverReplacement).toBeCloseTo(4.2, 12);
    expect(e.winShare).toBeCloseTo(8.4, 12);
    expect(e.boxPlusMinus).toBeCloseTo(10.5, 12);
  });

  // The property that makes games played the right anchor rather than the
  // calendar. A player who sat out the whole gap accrued nothing, and moving
  // his VORP forward would invent production during an absence — the same class
  // of error the availability factor exists to remove.
  it("holds a player who did not play completely flat", () => {
    const injured: AdvancedAnchor = { ...after, gamesPlayed: 40 };
    const e = interpolateAdvanced(before, injured, 40);

    expect(e.weight).toBe(0);
    expect(e.valueOverReplacement).toBe(before.valueOverReplacement);
    expect(e.winShare).toBe(before.winShare);
    expect(e.boxPlusMinus).toBe(before.boxPlusMinus);
  });

  // Two players across the same calendar gap, one who played four games and one
  // who played none, must not drift together.
  it("separates players who played from players who did not", () => {
    const played = interpolateAdvanced(before, after, 44);
    const sat = interpolateAdvanced(before, { ...after, gamesPlayed: 40 }, 40);

    expect(played.valueOverReplacement).toBeGreaterThan(sat.valueOverReplacement);
  });

  // Refusing is the point. A value outside the anchors is a guess, and once
  // written it looks exactly like a measurement.
  it("refuses to extrapolate past either anchor", () => {
    expect(() => interpolateAdvanced(before, after, 39)).toThrowError(/extrapolation/i);
    expect(() => interpolateAdvanced(before, after, 45)).toThrowError(/extrapolation/i);
  });

  it("rejects anchors given in the wrong order", () => {
    expect(() => interpolateAdvanced(after, before, 42)).toThrowError(/out of order/i);
  });

  // Box plus/minus can fall as well as rise, and win shares can dip when a
  // player's team loses games he played in. Nothing here assumes monotonicity.
  it("handles a stat that decreased between anchors", () => {
    const declining: AdvancedAnchor = { ...after, boxPlusMinus: 8.0 };
    const e = interpolateAdvanced(before, declining, 42);
    expect(e.boxPlusMinus).toBeCloseTo(9.0, 12);
  });
});
