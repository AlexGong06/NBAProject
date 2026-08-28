// The bottom tab bar, on phones only.
//
// Three destinations, matching the top nav's: the board, a player, and the
// formula. The nav's own links are hidden on mobile so the two are never both
// on screen — see Nav.tsx.

import { C } from "../theme";
import { HoverButton } from "./ui";

/** Height of the bar itself, before any home-indicator inset. */
export const TAB_BAR_HEIGHT = 82;

type Props = {
  view: "rankings" | "profile";
  panelOpen: boolean;
  onGoRankings: () => void;
  onOpenSearch: () => void;
  onTogglePanel: () => void;
};

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const PATHS = {
  list: "M224 128a8 8 0 01-8 8H40a8 8 0 010-16h176a8 8 0 018 8zM40 72h176a8 8 0 000-16H40a8 8 0 000 16zm176 112H40a8 8 0 000 16h176a8 8 0 000-16z",
  user: "M230.93 220a8 8 0 01-6.93 4H32a8 8 0 01-6.92-12c15.23-26.33 38.7-45.21 66.09-54.16a72 72 0 1177.66 0c27.39 8.95 50.86 27.83 66.09 54.16a8 8 0 01.01 8z",
  info: "M128 24a104 104 0 10104 104A104.11 104.11 0 00128 24zm0 192a88 88 0 1188-88 88.1 88.1 0 01-88 88zm16-40a8 8 0 01-8 8 16 16 0 01-16-16v-40a8 8 0 010-16 16 16 0 0116 16v40a8 8 0 018 8zm-32-92a12 12 0 1112-12 12 12 0 01-12 12z",
};

export default function TabBar({
  view, panelOpen, onGoRankings, onOpenSearch, onTogglePanel,
}: Props) {
  const tabs = [
    { id: "rankings", label: "Rankings", d: PATHS.list, on: view === "rankings", onPick: onGoRankings },
    { id: "players", label: "Players", d: PATHS.user, on: view === "profile", onPick: onOpenSearch },
    { id: "formula", label: "Formula", d: PATHS.info, on: panelOpen, onPick: onTogglePanel },
  ];

  return (
    <div
      // Fixed, not absolute: the bar stays put while the board scrolls under it.
      // The inset keeps the labels clear of the iPhone home indicator, and
      // resolves to 0 everywhere that has no such thing.
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        height: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        background: "rgba(22,24,38,0.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: `1px solid ${C.line}`,
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        alignItems: "start", paddingTop: 10, zIndex: 14,
      }}
    >
      {tabs.map((t) => (
        <HoverButton
          key={t.id}
          onClick={t.onPick}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
            background: "transparent", border: 0, padding: "6px 0",
            cursor: "pointer", color: t.on ? C.accentPale : C.textFaint,
          }}
          hoverStyle={{ color: C.accentPale }}
        >
          <Icon d={t.d} />
          <span style={{ fontSize: 10, letterSpacing: "0.04em" }}>{t.label}</span>
        </HoverButton>
      ))}
    </div>
  );
}
