import { useMemo } from "react";
import { C, fmt, initials } from "../theme";
import type { DataSource } from "../data/types";
import { HoverButton, SearchIcon } from "./ui";

type Props = {
  D: DataSource;
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  onOpenPlayer: (name: string) => void;
};

export default function SearchOverlay({ D, query, onQuery, onClose, onOpenPlayer }: Props) {
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = D.rankings(D.TODAY_KEY) ?? [];
    return rows
      .filter(
        (p) =>
          !q ||
          p.player.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q) ||
          (D.TEAMS[p.team] ?? "").toLowerCase().includes(q),
      )
      .map((p) => ({
        id: p.player,
        player: p.player,
        initials: initials(p.player),
        rank: `#${p.calculatedRank}`,
        meta: [D.TEAMS[p.team] ?? p.team, p.pos, `${p.pointsPerGame.toFixed(1)} PPG`]
          .filter(Boolean)
          .join(" · "),
        score: fmt(p.mvpValue),
      }));
  }, [D, query]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0,
        background: "rgba(12,13,22,0.74)", backdropFilter: "blur(3px)",
        zIndex: 60, display: "flex", justifyContent: "center", paddingTop: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 620, maxHeight: 560, background: "#1e2030",
          border: `1px solid ${C.textGhost}`, borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "16px 18px", borderBottom: `1px solid ${C.line}`,
          }}
        >
          <SearchIcon size={16} color={C.textFaint} />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search a player, team or abbreviation"
            style={{
              flex: 1, background: "transparent", border: 0, outline: "none",
              color: C.text, fontSize: 16, fontFamily: "inherit",
            }}
          />
          <HoverButton
            onClick={onClose}
            style={{
              fontSize: 10, letterSpacing: "0.06em", padding: "3px 7px",
              border: `1px solid ${C.lineStrong}`, borderRadius: 4,
              color: C.textFaint, background: "transparent", cursor: "pointer",
            }}
            hoverStyle={{ color: C.text }}
          >
            ESC
          </HoverButton>
        </div>

        <div style={{ overflow: "auto", padding: 8 }}>
          {results.map((r) => (
            <HoverButton
              key={r.id}
              onClick={() => onOpenPlayer(r.player)}
              style={{
                width: "100%", display: "grid",
                gridTemplateColumns: "40px 26px minmax(0, 1fr) auto",
                gap: 14, alignItems: "center", textAlign: "left",
                background: "transparent", border: 0, borderRadius: 8,
                padding: "10px 12px", cursor: "pointer",
              }}
              hoverStyle={{ background: C.raisedAlt }}
            >
              <span
                style={{
                  width: 36, height: 36, borderRadius: 999, background: C.raised,
                  border: `1px solid ${C.lineStrong}`, display: "grid",
                  placeItems: "center", fontSize: 11, color: C.textFaint,
                }}
              >
                {r.initials}
              </span>
              <span style={{ fontSize: 12, color: C.textGhost, fontVariantNumeric: "tabular-nums" }}>
                {r.rank}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, color: C.text }}>{r.player}</span>
                <span style={{ display: "block", fontSize: 11, color: C.textFaint }}>{r.meta}</span>
              </span>
              <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums", color: C.textMuted }}>
                {r.score}
              </span>
            </HoverButton>
          ))}

          {results.length === 0 && (
            <div style={{ padding: "34px 14px", textAlign: "center", color: C.textFaint, fontSize: 13 }}>
              No player matches “{query}”.
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 18px", borderTop: `1px solid ${C.line}`,
            fontSize: 11, color: C.textGhost, display: "flex", gap: 18,
          }}
        >
          <span>↑↓ to move</span>
          <span>↵ to open profile</span>
          <span>{results.length} tracked</span>
        </div>
      </div>
    </div>
  );
}
