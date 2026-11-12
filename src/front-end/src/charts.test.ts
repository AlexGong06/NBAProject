// The sparkline must never paint outside its own box.
//
// It is drawn into an SVG with `overflow: visible`, so a point outside the
// viewBox is not clipped — it lands on whatever markup sits underneath, which
// in the rankings list is the row's caption and then the next row. The bug this
// pins was a hardcoded top-8 axis: 9 of the 10 rows on the 2026-11-08 board
// drew outside, the worst by 119px, and every climb that began below #8 had its
// start silently cut off.
//
// `bumpChart` had the same bug and was fixed; `sparkline` was missed. Hence a
// test rather than a comment.

import { describe, it, expect } from "vitest";
import { sparkline, rankDomain, rankGeometry } from "./charts";
import type { DataSource, HistoryPoint } from "./data/types";

const W = 116;
const H = 30;
const PAD = { l: 2, r: 4, t: 4, b: 4 };
const TOP = PAD.t;
const BOTTOM = H - PAD.b;

function history(ranks: (number | null)[]): HistoryPoint[] {
  return ranks.map((rank, i) => ({
    date: { key: `11-${i + 1}-2026`, iso: `2026-11-${String(i + 1).padStart(2, "0")}` },
    noGames: false,
    carried: false,
    rank,
    score: rank == null ? null : 3 - rank / 50,
  })) as HistoryPoint[];
}

/** Only `history` is ever reached by `sparkline`. */
function sourceFor(ranks: (number | null)[]): DataSource {
  return { history: () => history(ranks) } as unknown as DataSource;
}

function ysOf(points: string): number[] {
  if (points === "") return [];
  return points.split(" ").map((p) => Number(p.split(",")[1]));
}

/** The real 14-day rank traces from the 2026-11-08 board. */
const REAL_BOARD: [string, number[]][] = [
  ["Wembanyama", [27, 23, 9, 3, 2, 2, 1, 2, 2, 2, 2, 2, 1, 1]],
  ["Dončić", [1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 2, 2]],
  ["Tatum", [21, 13, 7, 6, 5, 4, 4, 3, 5, 8, 8, 3, 3, 3]],
  ["Gilgeous-Alexander", [4, 7, 5, 11, 12, 10, 15, 14, 9, 6, 6, 5, 5, 4]],
  ["Jokić", [28, 28, 26, 20, 18, 13, 12, 12, 11, 7, 7, 6, 6, 5]],
  ["Maxey", [11, 10, 8, 7, 6, 5, 3, 4, 3, 4, 4, 8, 7, 6]],
  ["Cunningham", [8, 8, 12, 8, 7, 6, 6, 6, 4, 3, 3, 4, 4, 7]],
  ["Curry", [46, 23, 22, 32, 20, 16, 11, 11, 8, 8, 9, 9, 8, 8]],
  ["Flagg", [20, 20, 14, 15, 7, 8, 8, 12, 18, 18, 16, 15, 12, 9]],
  ["Reaves", [6, 6, 10, 12, 13, 19, 18, 19, 16, 12, 12, 11, 10, 10]],
];

describe("sparkline", () => {
  it.each(REAL_BOARD)("keeps %s inside the box", (_name, ranks) => {
    const ys = ysOf(sparkline(sourceFor(ranks), "p", "11-8-2026", W, H).points);

    expect(ys.length).toBe(ranks.length);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(TOP - 0.01);
      expect(y).toBeLessThanOrEqual(BOTTOM + 0.01);
    }
  });

  it("plots every point, including ranks far outside the top 8", () => {
    // The regression: Wembanyama's #27 and #23 were drawn below the box and
    // clipped, so his rise appeared to start at #9.
    const ranks = REAL_BOARD[0][1];
    const sp = sparkline(sourceFor(ranks), "p", "11-8-2026", W, H);
    const ys = ysOf(sp.points);

    expect(ys.length).toBe(ranks.length);
    // Worst rank first, best last: the line must descend from near the bottom
    // to near the top, not start mid-box.
    expect(ys[0]).toBeGreaterThan(BOTTOM - 8);
    expect(ys[ys.length - 1]).toBeLessThan(TOP + 8);
  });

  it("keeps the familiar 1-8 axis for players who never leave the top 8", () => {
    // Two contenders who both stayed inside the top 8 must share a scale, or
    // their rows cannot be read against each other.
    const a = ysOf(sparkline(sourceFor([1, 2, 3, 2, 1]), "a", "d", W, H).points);
    const b = ysOf(sparkline(sourceFor([3, 2, 1, 2, 3]), "b", "d", W, H).points);

    expect(a[0]).toBeCloseTo(b[2], 5); // both rank 1
    expect(a[2]).toBeCloseTo(b[0], 5); // both rank 3
  });

  it("survives a flat series without dividing by zero", () => {
    const ys = ysOf(sparkline(sourceFor([4, 4, 4, 4]), "p", "d", W, H).points);
    expect(ys).toHaveLength(4);
    for (const y of ys) expect(Number.isFinite(y)).toBe(true);
  });

  it("reports the last point, for the end dot", () => {
    const sp = sparkline(sourceFor([20, 10, 5]), "p", "d", W, H);
    const ys = ysOf(sp.points);
    // The points string is rounded to one decimal; `sp.y` is the raw float, so
    // they agree to the precision the string actually carries.
    expect(sp.y).toBeCloseTo(ys[ys.length - 1], 1);
    expect(sp.x).toBeLessThanOrEqual(W - PAD.r + 0.01);
  });

  it("skips days the player has no rank rather than drawing them at zero", () => {
    const ys = ysOf(sparkline(sourceFor([null, null, 12, 9, 7]), "p", "d", W, H).points);
    expect(ys).toHaveLength(3);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(TOP - 0.01);
      expect(y).toBeLessThanOrEqual(BOTTOM + 0.01);
    }
  });
});

describe("rankGeometry bounds", () => {
  it("maps any rank inside the domain into the padded band", () => {
    const { lo, hi } = rankDomain([history([46, 23, 22, 32, 8])]);
    const g = rankGeometry(history([46, 23, 22, 32, 8]), W, H, PAD, hi, lo);

    for (const d of g.dots) {
      expect(d.y).toBeGreaterThanOrEqual(TOP - 0.01);
      expect(d.y).toBeLessThanOrEqual(BOTTOM + 0.01);
    }
  });

  it("is what the hardcoded top-8 axis failed to do", () => {
    // Kept as the counter-example: this is the call sparkline used to make.
    const g = rankGeometry(history([46, 23, 22, 32, 8]), W, H, PAD, 8, 1);
    const worst = Math.max(...g.dots.map((d) => d.y));
    expect(worst).toBeGreaterThan(BOTTOM);
  });
});
