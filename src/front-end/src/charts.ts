// Chart geometry.
//
// Days the NBA did not play carry the previous game day's value forward, so a
// series runs flat through the All-Star break rather than breaking across it.
// A series does still split where a player genuinely has no value — before his
// debut, or on days the loaded board never held him — because there is nothing
// to draw a line between.

import { LINE_COLORS, C, initials } from "./theme";
import { headshotUrl } from "./data/headshot";
import type { DataSource, HistoryPoint } from "./data/types";

export type Pad = { l: number; r: number; t: number; b: number };
export type Dot = { x: number; y: number; rank: number; i: number; score: number | null };
export type Segment = { id: string; points: string; color: string; width: number };
export type Gap = { id: string; x1: number; y1: number; x2: number; y2: number; color: string };
export type GridLine = { id: string | number; y: number; ty: number; x1: number; x2: number; label: string };

/**
 * @param maxRank worst rank drawn at the bottom edge
 * @param minRank best rank drawn at the top edge. Defaults to 1, which is right
 *   for a leaderboard — but any player outside the top few needs a window
 *   around his own range, or his line falls off the bottom of the chart.
 */
export function rankGeometry(
  points: HistoryPoint[], w: number, h: number, pad: Pad, maxRank: number, minRank = 1,
) {
  const n = points.length;
  const x = (i: number) => pad.l + (n === 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  // Guard the degenerate span: a player whose rank never moves would otherwise
  // divide by zero and render at NaN, which draws nothing at all.
  const span = Math.max(1, maxRank - minRank);
  const y = (rank: number) => pad.t + ((rank - minRank) * (h - pad.t - pad.b)) / span;

  const segments: Dot[][] = [];
  const gaps: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const dots: Dot[] = [];
  let current: Dot[] = [];
  let lastGood: number | null = null;

  points.forEach((p, i) => {
    if (p.rank == null) return;
    const pt: Dot = { x: x(i), y: y(p.rank), rank: p.rank, i, score: p.score };
    dots.push(pt);
    if (lastGood !== null && i - lastGood > 1) {
      if (current.length) segments.push(current);
      const from = dots[dots.length - 2];
      gaps.push({ x1: from.x, y1: from.y, x2: pt.x, y2: pt.y });
      current = [pt];
    } else {
      current.push(pt);
    }
    lastGood = i;
  });
  if (current.length) segments.push(current);

  return {
    segments: segments
      .filter((s) => s.length > 1)
      .map((s, k) => ({
        id: String(k),
        points: s.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
      })),
    gaps: gaps.map((g, k) => ({ ...g, id: String(k) })),
    dots,
  };
}

/**
 * The rank window to draw, given every series that will be plotted.
 *
 * Never hardcode #1-#8: any of 582 players can be opened, and a fixed top-8
 * axis draws everyone else below the bottom edge — an empty chart, which reads
 * as "no data" rather than "off the scale". Contenders keep the familiar view;
 * anyone below gets a window around his own range.
 */
export function rankDomain(series: HistoryPoint[][]): { lo: number; hi: number } {
  const ranks: number[] = [];
  for (const points of series) {
    for (const p of points) if (p.rank != null) ranks.push(p.rank);
  }
  if (ranks.length === 0) return { lo: 1, hi: 8 };

  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);
  if (worst <= 8) return { lo: 1, hi: 8 };

  const margin = Math.max(1, Math.ceil((worst - best) * 0.15));
  return { lo: Math.max(1, best - margin), hi: worst + margin };
}

/**
 * Horizontal rank lines for a domain.
 *
 * Eight evenly spaced lines for the top-8 view, five otherwise — enough to read
 * a wide range without crowding the labels. The Set is not decoration: a narrow
 * window like #181-#184 rounds several of the five fractions onto the same
 * rank, and without it the chart draws "#182" twice on top of itself.
 */
function rankGrid(
  lo: number, hi: number, w: number, h: number, pad: Pad, lines = 5,
): GridLine[] {
  const ranks =
    lo === 1 && hi === 8 && lines >= 8
      ? [1, 2, 3, 4, 5, 6, 7, 8]
      : [...new Set(Array.from({ length: lines }, (_, i) => Math.round(lo + ((hi - lo) * i) / (lines - 1))))];

  return ranks.map((r) => {
    const y = pad.t + ((r - lo) * (h - pad.t - pad.b)) / Math.max(1, hi - lo);
    return { id: r, y, ty: y + 4, x1: pad.l, x2: w - pad.r, label: `#${r}` };
  });
}

/** Small inline rank trace for a table row. */
export function sparkline(D: DataSource, name: string, dateKey: string, w: number, h: number) {
  const pts = D.history(name, dateKey, 14);
  const g = rankGeometry(pts, w, h, { l: 2, r: 4, t: 4, b: 4 }, 8);
  const last = g.dots[g.dots.length - 1] ?? { x: 0, y: 0 };
  return {
    points: g.dots.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(" "),
    x: last.x,
    y: last.y,
  };
}

/** Radius of the headshot that terminates each line in the bump chart. */
const BUMP_FACE = 11;

/**
 * "Race to #1" — the top five **on the selected date**, rank by day, last 14.
 *
 * The cast must come from `dateKey`, not from `D.TODAY_KEY`: drawing the
 * season-final leaders over an earlier date's window puts players in the chart
 * who are not on the board directly beneath it. The axis follows the players
 * actually plotted, or a slip to #12 paints outside a 176-tall box.
 */
export function bumpChart(D: DataSource, dateKey: string) {
  const w = 300, h = 176, pad: Pad = { l: 22, r: 34, t: 14, b: 26 };
  const top = (D.standingsFor(dateKey)?.rows ?? []).slice(0, 5);
  const segments: Segment[] = [];
  const gaps: Gap[] = [];
  const ends: {
    id: string; x: number; y: number; cx: number; cy: number;
    color: string; player: string; initials: string; headshot: string | null;
  }[] = [];

  const series = top.map((p) => D.history(p.player, dateKey, 14));
  const { lo, hi } = rankDomain(series);

  top.forEach((p, i) => {
    const g = rankGeometry(series[i], w, h, pad, hi, lo);
    const color = LINE_COLORS[i];
    g.segments.forEach((s) => segments.push({ id: p.player + s.id, points: s.points, color, width: i === 0 ? 2 : 1.4 }));
    g.gaps.forEach((s) => gaps.push({ ...s, id: p.player + s.id, color }));
    const last = g.dots[g.dots.length - 1];
    if (last) {
      ends.push({
        id: p.player,
        x: last.x, y: last.y,
        cx: w - BUMP_FACE - 5, cy: last.y,
        color,
        player: p.player,
        initials: initials(p.player),
        headshot: headshotUrl(p),
      });
    }
  });

  // Keep the faces from stacking on top of each other, then move the column as
  // a unit to fit the plot band.
  //
  // The two corrections have to be whole-column shifts, not per-face clamps. A
  // clamp is what was here first, and it silently undid the spacing it had just
  // created: rank 1 sits above the top bound, gets pushed back down to it, and
  // lands 13px from rank 2 — overlapping the very neighbour the spacing pass
  // had separated. Five faces need 96px of a 125px band, so shifting always
  // fits.
  const minGap = BUMP_FACE * 2 + 2;
  ends.sort((a, b) => a.cy - b.cy);
  for (let i = 1; i < ends.length; i++) {
    const overlap = ends[i - 1].cy + minGap - ends[i].cy;
    if (overlap > 0) ends[i].cy += overlap;
  }

  if (ends.length) {
    const top = pad.t + BUMP_FACE;
    const bottom = h - pad.b - BUMP_FACE;
    const belowFloor = ends[ends.length - 1].cy - bottom;
    if (belowFloor > 0) for (const e of ends) e.cy -= belowFloor;
    const aboveCeiling = top - ends[0].cy;
    if (aboveCeiling > 0) for (const e of ends) e.cy += aboveCeiling;
  }

  // Four lines, not the profile's five or eight — this card is 176px tall and a
  // denser axis crowds the labels into each other.
  const grid: GridLine[] = rankGrid(lo, hi, w, h, pad, 4).map((g) => ({
    ...g,
    ty: g.y + 3,
  }));

  return { grid, segments, gaps, ends, faceRadius: BUMP_FACE };
}

export type ChartMode = "rank" | "score";

/**
 * The chart's own coordinate space, which is also its aspect ratio.
 *
 * The SVG is drawn at `width: 100%`, so the viewBox is scaled to fit and the
 * label text scales with it. Rendering the 820-wide desktop box on a 358px
 * phone shrinks 10px labels to about 4px — legible in the sense that pixels are
 * present. The narrow box keeps text near its intended size.
 */
export const CHART_SIZE = {
  desktop: { w: 820, h: 300 },
  mobile: { w: 360, h: 250 },
} as const;

/** The profile's main chart. Two modes over the same window. */
export function mainChart(
  D: DataSource, name: string, dateKey: string, days: number, mode: ChartMode,
  size: { w: number; h: number } = CHART_SIZE.desktop,
) {
  const narrow = size.w < 500;
  const w = size.w, h = size.h;
  const pad: Pad = narrow
    ? { l: 26, r: 34, t: 12, b: 42 }
    : { l: 34, r: 56, t: 14, b: 56 };
  const out = {
    segments: [] as Segment[],
    gaps: [] as Gap[],
    dots: [] as { id: string; x: number; y: number; r: number; color: string }[],
    ends: [] as { id: string; tx: number; ty: number; color: string; label: string }[],
    grid: [] as GridLine[],
    xTicks: [] as { id: number; x: number; label: string }[],
    title: "",
    subtitle: "",
  };

  const base = D.history(name, dateKey, days);
  const n = base.length;
  const X = (i: number) => pad.l + (n === 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));

  // Days with no games used to be drawn as shaded bands labelled "no scrape".
  // They are carried forward now, so the line simply runs flat through them —
  // which is what happened. Nothing was missed; nobody played.

  // Half as many ticks in the narrow box — the same count that is comfortable
  // across 820px collides across 360.
  const tickEvery = (n > 20 ? 5 : n > 10 ? 3 : 2) * (narrow ? 2 : 1);
  base.forEach((p, i) => {
    if (i % tickEvery !== 0 && i !== n - 1) return;
    // The final tick is always drawn, so on a narrow chart it can land on top
    // of the one before it. Drop that neighbour rather than overprint.
    const last = out.xTicks[out.xTicks.length - 1];
    if (last && i === n - 1 && X(i) - last.x < (narrow ? 42 : 30)) out.xTicks.pop();
    out.xTicks.push({ id: i, x: X(i), label: p.date.short });
  });

  if (mode === "score") {
    const vals = base.filter((p) => p.score != null).map((p) => p.score as number);
    const lo = Math.min(...vals) * 0.985;
    const hi = Math.max(...vals) * 1.015;
    const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    out.grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const v = lo + f * (hi - lo);
      return { id: f, y: Y(v), ty: Y(v) + 4, x1: pad.l, x2: w - pad.r, label: v.toFixed(2) };
    });

    let run: { x: number; y: number }[] = [];
    let lastIdx: number | null = null;
    base.forEach((p, i) => {
      if (p.score == null) return;
      const pt = { x: X(i), y: Y(p.score) };
      if (lastIdx !== null && i - lastIdx > 1) {
        if (run.length > 1) {
          out.segments.push({ id: `s${i}`, points: run.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "), color: C.accentBright, width: 2.4 });
        }
        const prev = run[run.length - 1];
        if (prev) out.gaps.push({ id: `g${i}`, x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y, color: C.accentBright });
        run = [pt];
      } else {
        run.push(pt);
      }
      out.dots.push({ id: `d${i}`, x: pt.x, y: pt.y, r: i === n - 1 ? 4 : 2.6, color: C.accentBright });
      lastIdx = i;
    });
    if (run.length > 1) {
      out.segments.push({ id: "sEnd", points: run.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "), color: C.accentBright, width: 2.4 });
    }
    out.title = "MVP value over time";
    out.subtitle = "The raw score, not the placing — small moves here can flip a rank";
    return out;
  }

  // The rank axis follows the player — see rankDomain.
  const { lo, hi } = rankDomain([base]);
  const g = rankGeometry(base, w, h, pad, hi, lo);
  out.grid = rankGrid(lo, hi, w, h, pad);
  g.segments.forEach((s) => out.segments.push({ id: `s${s.id}`, points: s.points, color: C.accentBright, width: 2.6 }));
  g.gaps.forEach((s) => out.gaps.push({ ...s, id: `g${s.id}`, color: C.accentBright }));
  g.dots.forEach((d, i) => out.dots.push({ id: `d${i}`, x: d.x, y: d.y, r: i === g.dots.length - 1 ? 4.5 : 3, color: C.accentBright }));
  out.title = "MVP rank over time";
  out.subtitle = "Lower is better — flat where the NBA played no games";
  return out;
}
