// Which season the whole app is showing.
//
// Switching seasons is not a filter — it reloads the data source, because
// every number on screen is scoped to one season: the calendar, the board, the
// ranks, the charts, the roster. So this is deliberately a small, quiet
// control rather than a prominent one. It sits where the season label always
// sat, in the nav, and reads as a label until you touch it.
//
// Renders nothing below two seasons. The offline fixture holds one, and so
// does a deployment on opening night — a dropdown that cannot go anywhere is
// worse than the plain text it replaced.

import { useEffect, useRef, useState } from "react";
import { C } from "../theme";
import { ChevronDown } from "./ui";
import type { SeasonOption } from "../data/types";

type Props = {
  seasons: SeasonOption[];
  /** The season on screen, as an id — "2026-27". */
  current: string;
  /** Display form of the current season, for the one-season case. */
  currentLabel: string;
  onPick: (seasonId: string) => void;
  /** True while a season is being loaded; the control locks rather than queues. */
  busy?: boolean;
};

/** "2026-10-20" → "Oct 20". The extent line under each option. */
function shortDate(iso: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export default function SeasonPicker({
  seasons, current, currentLabel, onPick, busy,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Without the first, the menu survives
  // a click on the board behind it and floats over a page it no longer
  // belongs to.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const chip: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.08em",
    color: C.textFaint,
    paddingLeft: 10,
    borderLeft: `1px solid ${C.lineStrong}`,
  };

  // One season is not a choice. Render exactly what was there before a picker
  // existed, so nothing shifts when a deployment has only built one.
  if (seasons.length < 2) {
    return <div style={chip}>{currentLabel}</div>;
  }

  const selected = seasons.find((s) => s.id === current);

  return (
    <div ref={wrap} style={{ position: "relative", ...chip }}>
      <button
        type="button"
        onClick={() => !busy && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Season: ${selected?.label ?? currentLabel}. Change season.`}
        disabled={busy}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          font: "inherit", fontSize: 11, letterSpacing: "0.08em",
          background: "none", border: 0, padding: "4px 0",
          color: open ? C.text : C.textFaint,
          cursor: busy ? "progress" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {selected?.label ?? currentLabel}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: 2,
            minWidth: 210, zIndex: 40,
            background: C.raised,
            border: `1px solid ${C.lineStrong}`,
            borderRadius: 10,
            padding: 4,
            boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
          }}
        >
          {seasons.map((s) => {
            const active = s.id === current;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setOpen(false);
                  if (!active) onPick(s.id);
                }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  font: "inherit", border: 0, borderRadius: 7,
                  padding: "8px 10px", cursor: "pointer",
                  background: active ? C.accentWash : "transparent",
                  color: active ? C.text : C.textMuted,
                }}
              >
                <div style={{ fontSize: 13, letterSpacing: "0.02em" }}>
                  {s.label}
                  {active && (
                    <span style={{ color: C.accent, marginLeft: 8, fontSize: 11 }}>
                      showing
                    </span>
                  )}
                </div>
                {/* The extent, not the schedule. A season in progress ends at
                    the most recent night ingested, and saying so is what stops
                    a 20-day ribbon reading as missing data. */}
                <div style={{ fontSize: 11, color: C.textGhost, marginTop: 2 }}>
                  {shortDate(s.firstDate)} – {shortDate(s.lastDate)} · {s.gameDays} game days
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
