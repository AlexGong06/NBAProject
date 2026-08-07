// 30-day collector health strip. Hollow, dashed cells are days the scraper
// failed — they stay visible rather than being dropped, so a gap in the record
// is something you can see and click into.

import { C, label } from "../theme";
import type { DataSource } from "../data/types";

type Props = {
  D: DataSource;
  dateKey: string;
  onPick: (key: string) => void;
};

export default function ScrapeRibbon({ D, dateKey, onPick }: Props) {
  const cells = D.DATES.map((d, i) => {
    const active = d.key === dateKey;
    const missing = D.MISSING.has(d.key);
    return {
      key: d.key,
      x: i * 22,
      y: active ? 2 : 6,
      h: active ? 30 : 22,
      fill: missing ? C.bg : active ? C.accent : i > 24 ? C.accentDeep : C.lineStrong,
      stroke: missing ? C.lineStrong : active ? C.accentBright : "transparent",
      dash: missing ? "2 2" : "0",
      title: missing ? `${d.long} — no scrape` : d.long,
    };
  });

  const collected = D.DATES.length - D.MISSING.size;

  return (
    <div
      style={{
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        background: C.surface,
        padding: "16px 18px 12px",
        marginBottom: 32,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={label}>Last {D.DATES.length} scrapes</div>
        <div style={{ fontSize: 11, color: C.textFaint }}>
          {collected} of {D.DATES.length} days collected
        </div>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${Math.max(656, D.DATES.length * 22)} 40`}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {cells.map((c) => (
          <rect
            key={c.key}
            x={c.x} y={c.y} width={18} height={c.h} rx={3}
            fill={c.fill} stroke={c.stroke} strokeWidth={1} strokeDasharray={c.dash}
            onClick={() => onPick(c.key)}
            style={{ cursor: "pointer" }}
          >
            <title>{c.title}</title>
          </rect>
        ))}
      </svg>

      <div
        style={{
          display: "flex", justifyContent: "space-between", marginTop: 8,
          fontSize: 10, color: C.textGhost, letterSpacing: "0.04em",
        }}
      >
        <span>{D.DATES[0].long}</span>
        <span>{D.DATES[D.DATES.length - 1].long}</span>
      </div>
    </div>
  );
}
