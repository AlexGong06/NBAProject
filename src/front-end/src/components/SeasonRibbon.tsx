// The season as a strip of days, and the app's primary date picker.
//
// One cell per calendar day from opening night to the finale. Hollow, dashed
// cells are days the NBA played no games — Thanksgiving, Christmas Eve, the NBA
// Cup final, the All-Star break. Ten of them in 2025-26.
//
// They stay visible and stay clickable. An off day still has standings: the
// ones from the last game day, unchanged, because nobody played. This strip
// used to describe those days as a collector's failures, back when the data
// arrived from a nightly Basketball Reference scrape instead of being rebuilt
// in one pass from the NBA stats API.

import { C, label } from "../theme";
import type { DataSource } from "../data/types";

type Props = {
  D: DataSource;
  dateKey: string;
  onPick: (key: string) => void;
};

export default function SeasonRibbon({ D, dateKey, onPick }: Props) {
  const cells = D.DATES.map((d, i) => {
    const active = d.key === dateKey;
    const noGames = D.NO_GAME_DAYS.has(d.key);
    return {
      key: d.key,
      x: i * 22,
      y: active ? 2 : 6,
      h: active ? 30 : 22,
      // Three states, and only three: the day you are looking at, a day games
      // were played, and a day they were not. There used to be a fourth —
      // `i > 24` painted a brighter colour — which meant "within the last 30
      // days" when this strip was 30 cells long. Across 174 it only made the
      // first three weeks of the season look categorically different from the
      // rest, for no reason a reader could recover.
      fill: noGames ? C.bg : active ? C.accent : C.accentDeep,
      stroke: noGames ? C.lineStrong : active ? C.accentBright : "transparent",
      dash: noGames ? "2 2" : "0",
      title: noGames ? `${d.long} — no NBA games` : d.long,
    };
  });

  const gameDays = D.DATES.length - D.NO_GAME_DAYS.size;

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
        <div style={label}>2025–26 season</div>
        <div style={{ fontSize: 11, color: C.textFaint }}>
          {gameDays} game days · {D.NO_GAME_DAYS.size} without games
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
