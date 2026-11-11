import { C } from "../theme";
import { HoverButton, SearchIcon } from "./ui";
import SeasonPicker from "./SeasonPicker";
import { useIsMobile } from "../use-media-query";
import type { SeasonOption } from "../data/types";

type Props = {
  view: "rankings" | "profile";
  /** Display label for the season on screen, e.g. "2026–27". */
  season: string;
  /** Id form of the same season — "2026-27". */
  seasonId: string;
  /** Every season that can be switched to; fewer than two hides the picker. */
  seasons: SeasonOption[];
  onPickSeason: (seasonId: string) => void;
  /** True while a season is loading. */
  seasonBusy?: boolean;
  onGoRankings: () => void;
  onOpenSearch: () => void;
  onTogglePanel: () => void;
};

const tabBase: React.CSSProperties = {
  background: "none",
  border: 0,
  padding: "21px 14px",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

export default function Nav({
  view, season, seasonId, seasons, onPickSeason, seasonBusy,
  onGoRankings, onOpenSearch, onTogglePanel,
}: Props) {
  const isRankings = view === "rankings";
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        height: 64,
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 14 : 32,
        padding: isMobile ? "0 14px" : "0 40px",
        borderBottom: `1px solid ${C.lineFaint}`,
        position: "sticky",
        top: 0,
        background: C.bg,
        zIndex: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 18, height: 18, borderRadius: 4,
            background: C.accent,
            boxShadow: "0 0 18px rgba(145,132,217,0.55)",
          }}
        />
        <div style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600 }}>
          MVP Tracker
        </div>
        {/* Shown on a phone too, unlike the static label it replaces. A
            season label is decoration and can be dropped on a small screen;
            the only way to reach another season is not. */}
        <SeasonPicker
          seasons={seasons}
          current={seasonId}
          currentLabel={season}
          onPick={onPickSeason}
          busy={seasonBusy}
        />
      </div>

      {/* These two live in the bottom tab bar on a phone. Both at once would be
          two sets of the same destinations on one screen. */}
      {!isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <HoverButton
            onClick={onGoRankings}
            style={{
              ...tabBase,
              color: isRankings ? C.text : C.textDim,
              borderBottom: `2px solid ${isRankings ? C.accent : "transparent"}`,
            }}
            hoverStyle={{ color: C.text }}
          >
            Rankings
          </HoverButton>
          <HoverButton
            onClick={onOpenSearch}
            style={{
              ...tabBase,
              color: isRankings ? C.textDim : C.text,
              borderBottom: `2px solid ${isRankings ? "transparent" : C.accent}`,
            }}
            hoverStyle={{ color: C.text }}
          >
            Players
          </HoverButton>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <HoverButton
        onClick={onOpenSearch}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          height: isMobile ? 38 : 34,
          width: isMobile ? 38 : undefined,
          justifyContent: isMobile ? "center" : undefined,
          padding: isMobile ? 0 : "0 10px 0 12px",
          background: C.surfaceAlt,
          border: `1px solid ${C.lineStrong}`,
          borderRadius: 8, color: C.textFaint, fontSize: 13,
          cursor: "pointer", minWidth: isMobile ? 0 : 240, textAlign: "left",
        }}
        hoverStyle={{ borderColor: C.accentDeep, color: C.textDim }}
      >
        <SearchIcon />
        {/* The label and the shortcut hint are both desktop affordances — a
            phone has no ⌘K, and the icon alone is understood. */}
        {!isMobile && (
          <>
            <span style={{ flex: 1 }}>Search players</span>
            <span
              style={{
                fontSize: 10, letterSpacing: "0.06em", padding: "2px 6px",
                border: `1px solid ${C.lineStrong}`, borderRadius: 4, color: C.textFaint,
              }}
            >
              ⌘K
            </span>
          </>
        )}
      </HoverButton>

      {/* Dropped on a phone, not shrunk: the formula is reachable from "Open the
          breakdown" on the board and "See the math" on a profile, so nothing
          becomes unreachable and the bar stops overflowing. */}
      {!isMobile && (
        <HoverButton
          onClick={onTogglePanel}
          style={{
            height: 34, padding: "0 14px", background: "transparent",
            border: `1px solid ${C.accentDeep}`, borderRadius: 8,
            color: C.accentPale, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
          }}
          hoverStyle={{ background: C.accentWash, borderColor: C.accent }}
        >
          How it works
        </HoverButton>
      )}
    </div>
  );
}
