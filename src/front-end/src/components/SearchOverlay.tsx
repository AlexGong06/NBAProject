import { useMemo } from "react";
import { C, fmt, initials } from "../theme";
import type { DataSource } from "../data/types";
import { headshotUrl } from "../data/headshot";
import { Headshot, HoverButton, SearchIcon } from "./ui";
import { useIsMobile } from "../use-media-query";

type Props = {
  D: DataSource;
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  onOpenPlayer: (name: string) => void;
};

export default function SearchOverlay({ D, query, onQuery, onClose, onOpenPlayer }: Props) {
  const isMobile = useIsMobile();
  // Search covers ROSTER — the whole league — not the loaded board.
  //
  // This used to filter `rankings(TODAY_KEY)`, which is a single date's top N,
  // so searching found about 25 of 582 players. Everyone else was in the
  // database and simply unreachable from the UI.
  //
  // Ranks come from position in ROSTER, which the API returns ordered by score
  // on the most recent date. Rank is still never read off a stored field.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return D.ROSTER.filter(
      (p) =>
        !q ||
        p.player.toLowerCase().includes(q) ||
        p.team.toLowerCase().includes(q) ||
        (D.TEAMS[p.team] ?? "").toLowerCase().includes(q),
    )
      .slice(0, 60) // 582 rows is a scroll, not a result list
      .map((p) => ({
        id: p.player,
        player: p.player,
        initials: initials(p.player),
        headshot: headshotUrl(p),
        rank: `#${D.ROSTER.indexOf(p) + 1}`,
        meta: [D.TEAMS[p.team] ?? p.team, p.pos, `${p.pointsPerGame.toFixed(1)} PPG`]
          .filter(Boolean)
          .join(" · "),
        score: fmt(p.mvpValue),
      }));
  }, [D, query]);

  return (
    <div
      onClick={onClose}
      // A phone gets a full-screen sheet rather than a floating dialog: a
      // 620px modal does not fit, and there is no room around it for a scrim
      // to be worth dimming.
      style={
        isMobile
          ? { position: "fixed", inset: 0, background: C.bg, zIndex: 60, display: "flex" }
          : {
              position: "absolute", inset: 0,
              background: "rgba(12,13,22,0.74)", backdropFilter: "blur(3px)",
              zIndex: 60, display: "flex", justifyContent: "center", paddingTop: 120,
            }
      }
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={
          isMobile
            ? {
                width: "100%", height: "100%", background: C.bg,
                display: "flex", flexDirection: "column", overflow: "hidden",
              }
            : {
                width: 620, maxHeight: 560, background: "#1e2030",
                border: `1px solid ${C.textGhost}`, borderRadius: 14,
                boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
                display: "flex", flexDirection: "column",
              }
        }
      >
        <div
          style={
            isMobile
              ? { display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 12px" }
              : {
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "16px 18px", borderBottom: `1px solid ${C.line}`,
                }
          }
        >
          <div
            style={
              isMobile
                ? {
                    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10,
                    height: 44, padding: "0 14px", borderRadius: 12,
                    background: C.surfaceAlt, border: `1px solid ${C.line}`,
                  }
                : { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12 }
            }
          >
            <SearchIcon size={16} color={C.textFaint} />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={isMobile ? "Player, team or abbreviation" : "Search a player, team or abbreviation"}
              style={{
                flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none",
                color: C.text, fontSize: isMobile ? 15 : 16, fontFamily: "inherit",
              }}
            />
          </div>
          {/* "ESC" names a key a phone does not have. */}
          <HoverButton
            onClick={onClose}
            style={
              isMobile
                ? {
                    height: 44, padding: "0 6px", fontSize: 14, flex: "none",
                    background: "transparent", border: 0, color: C.textDim, cursor: "pointer",
                  }
                : {
                    fontSize: 10, letterSpacing: "0.06em", padding: "3px 7px",
                    border: `1px solid ${C.lineStrong}`, borderRadius: 4,
                    color: C.textFaint, background: "transparent", cursor: "pointer",
                  }
            }
            hoverStyle={{ color: C.text }}
          >
            {isMobile ? "Cancel" : "ESC"}
          </HoverButton>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: isMobile ? "0 12px 8px" : 8 }}>
          {results.map((r) => (
            <HoverButton
              key={r.id}
              onClick={() => onOpenPlayer(r.player)}
              style={{
                width: "100%", display: "grid",
                gridTemplateColumns: isMobile
                  ? "42px 26px minmax(0, 1fr) auto"
                  : "40px 26px minmax(0, 1fr) auto",
                gap: isMobile ? 12 : 14, alignItems: "center", textAlign: "left",
                background: "transparent", border: 0, borderRadius: isMobile ? 10 : 8,
                padding: isMobile ? "10px 8px" : "10px 12px", cursor: "pointer",
              }}
              hoverStyle={{ background: C.raisedAlt }}
            >
              <span
                style={{
                  position: "relative", width: isMobile ? 42 : 36, height: isMobile ? 42 : 36,
                  borderRadius: 999,
                  background: C.raised, border: `1px solid ${C.lineStrong}`,
                  display: "block", overflow: "hidden",
                }}
              >
                <Headshot
                  src={r.headshot}
                  initials={r.initials}
                  size={isMobile ? 42 : 36}
                  fontSize={isMobile ? 12 : 11}
                />
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

        {/* The arrow and return hints name keys a phone does not have, so it
            keeps only the count. */}
        <div
          style={{
            padding: isMobile ? "10px 16px" : "10px 18px",
            borderTop: `1px solid ${C.line}`,
            fontSize: 11, color: C.textGhost, display: "flex", gap: 18,
          }}
        >
          {!isMobile && (
            <>
              <span>↑↓ to move</span>
              <span>↵ to open profile</span>
            </>
          )}
          <span>{results.length} tracked</span>
        </div>
      </div>
    </div>
  );
}
