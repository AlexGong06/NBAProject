// Chart geometry. Every series splits at days the collector missed, so a gap in
// the data renders as a dashed connector rather than a straight line that
// quietly implies continuity.

import { LINE_COLORS, C } from "./theme";
import type { DataSource, HistoryPoint } from "./data/types";

export type Pad = { l: number; r: number; t: number; b: number };
export type Dot = { x: number; y: number; rank: number; i: number; score: number | null };
export type Segment = { id: string; points: string; color: string; width: number };
export type Gap = { id: string; x1: number; y1: number; x2: number; y2: number; color: string };
export type GridLine = { id: string | number; y: number; ty: number; x1: number; x2: number; label: string };

export function rankGeometry(
  points: HistoryPoint[], w: number, h: number, pad: Pad, maxRank: number,
) {
  const n = points.length;
  const x = (i: number) => pad.l + (n === 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (rank: number) => pad.t + ((rank - 1) * (h - pad.t - pad.b)) / (maxRank - 1);

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

/** "Race to #1" — top five, rank by day, last 14. */
export function bumpChart(D: DataSource, dateKey: string) {
  const w = 300, h = 176, pad: Pad = { l: 22, r: 46, t: 10, b: 26 };
  const top = (D.rankings(D.TODAY_KEY) ?? []).slice(0, 5);
  const segments: Segment[] = [];
  const gaps: Gap[] = [];
  const ends: { id: string; x: number; y: number; tx: number; ty: number; color: string; label: string }[] = [];

  top.forEach((p, i) => {
    const g = rankGeometry(D.history(p.player, dateKey, 14), w, h, pad, 8);
    const color = LINE_COLORS[i];
    g.segments.forEach((s) => segments.push({ id: p.player + s.id, points: s.points, color, width: i === 0 ? 2 : 1.4 }));
    g.gaps.forEach((s) => gaps.push({ ...s, id: p.player + s.id, color }));
    const last = g.dots[g.dots.length - 1];
    if (last) ends.push({ id: p.player, x: last.x, y: last.y, tx: w - 4, ty: last.y + 3, color, label: p.team });
  });

  const grid: GridLine[] = [1, 3, 5, 8].map((r) => {
    const y = pad.t + ((r - 1) * (h - pad.t - pad.b)) / 7;
    return { id: r, y, ty: y + 3, x1: pad.l, x2: w - pad.r, label: `#${r}` };
  });

  return { grid, segments, gaps, ends };
}

export type ChartMode = "rank" | "score" | "field";

/** The profile's main chart. Three modes over the same window. */
export function mainChart(
  D: DataSource, name: string, dateKey: string, days: number, mode: ChartMode,
) {
  const w = 820, h = 300, pad: Pad = { l: 34, r: 56, t: 14, b: 56 };
  const out = {
    segments: [] as Segment[],
    gaps: [] as Gap[],
    dots: [] as { id: string; x: number; y: number; r: number; color: string }[],
    ends: [] as { id: string; tx: number; ty: number; color: string; label: string }[],
    grid: [] as GridLine[],
    xTicks: [] as { id: number; x: number; label: string }[],
    missing: [] as { id: number; x: number; w: number; tx: number }[],
    title: "",
    subtitle: "",
  };

  const base = D.history(name, dateKey, days);
  const n = base.length;
  const X = (i: number) => pad.l + (n === 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const step = (w - pad.l - pad.r) / Math.max(1, n - 1);

  base.forEach((p, i) => {
    if (p.missing) out.missing.push({ id: i, x: X(i) - step * 0.42, w: step * 0.84, tx: X(i) });
  });

  const tickEvery = n > 20 ? 5 : n > 10 ? 3 : 2;
  base.forEach((p, i) => {
    if (i % tickEvery === 0 || i === n - 1) out.xTicks.push({ id: i, x: X(i), label: p.date.short });
  });

  if (mode === "field") {
    const top = (D.rankings(D.TODAY_KEY) ?? []).slice(0, 5);
    out.grid = [1, 2, 4, 6, 8].map((r) => {
      const y = pad.t + ((r - 1) * (h - pad.t - pad.b)) / 7;
      return { id: r, y, ty: y + 4, x1: pad.l, x2: w - pad.r, label: `#${r}` };
    });
    top.forEach((p, i) => {
      const g = rankGeometry(D.history(p.player, dateKey, days), w, h, pad, 8);
      const isSel = p.player === name;
      const color = isSel ? C.accentBright : LINE_COLORS[Math.min(i + 1, 4)];
      g.segments.forEach((s) => out.segments.push({ id: `${p.player}s${s.id}`, points: s.points, color, width: isSel ? 2.6 : 1.4 }));
      g.gaps.forEach((s) => out.gaps.push({ ...s, id: `${p.player}g${s.id}`, color }));
      const last = g.dots[g.dots.length - 1];
      if (last) out.ends.push({ id: p.player, tx: w - pad.r + 10, ty: last.y + 4, color, label: p.team });
    });
    out.title = "Rank vs the field";
    out.subtitle = "Top 5 candidates, rank by day — dashed where the collector missed a day";
    return out;
  }

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

  const g = rankGeometry(base, w, h, pad, 8);
  out.grid = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => {
    const y = pad.t + ((r - 1) * (h - pad.t - pad.b)) / 7;
    return { id: r, y, ty: y + 4, x1: pad.l, x2: w - pad.r, label: `#${r}` };
  });
  g.segments.forEach((s) => out.segments.push({ id: `s${s.id}`, points: s.points, color: C.accentBright, width: 2.6 }));
  g.gaps.forEach((s) => out.gaps.push({ ...s, id: `g${s.id}`, color: C.accentBright }));
  g.dots.forEach((d, i) => out.dots.push({ id: `d${i}`, x: d.x, y: d.y, r: i === g.dots.length - 1 ? 4.5 : 3, color: C.accentBright }));
  out.title = "MVP rank over time";
  out.subtitle = "Lower is better — dashed where the collector missed a day";
  return out;
}
