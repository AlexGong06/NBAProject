// The season as a month rail and a strip of days — the date picker on phones.
//
// `SeasonRibbon` renders the whole season as 174 cells, which is legible on a
// desktop and gives each day about 2px on a phone. This is the same job done
// coarse-then-fine: pick a month, then a day, with both always on screen and
// 44px targets throughout.
//
// The arrows step GAME days, not calendar days. Stepping one day at a time
// through the All-Star break is six taps that change nothing on screen.

import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../theme";
import type { DataSource, DateInfo } from "../data/types";
import { HoverButton } from "./ui";
import { ChevronLeft, ChevronRight } from "./ui";

type Props = {
  D: DataSource;
  dateKey: string;
  onPick: (key: string) => void;
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** One card plus its gap. Scroll rests land on multiples of this. */
const PITCH = 50;

type Month = { label: string; year: string; idx: number[] };

/**
 * The season's calendar months, each holding its own indices into `D.DATES`.
 *
 * Derived from `iso` rather than by parsing `key` through a Date: "YYYY-MM-DD"
 * splits without going near a timezone, and constructing a Date from a date-only
 * string parses it as UTC, which shifts the day for anyone west of Greenwich.
 */
function monthList(dates: DateInfo[]): Month[] {
  const out: Month[] = [];
  dates.forEach((d, i) => {
    const [y, m] = d.iso.split("-");
    const label = MONTH_SHORT[Number(m) - 1];
    const last = out[out.length - 1];
    if (last && last.label === label && last.year === y) last.idx.push(i);
    else out.push({ label, year: y, idx: [i] });
  });
  return out;
}

/** Day of the month, from the ISO twin. Same timezone reasoning as above. */
function dayOf(d: DateInfo): number {
  return Number(d.iso.split("-")[2]);
}

export default function MobileDatePicker({ D, dateKey, onPick }: Props) {
  const months = useMemo(() => monthList(D.DATES), [D.DATES]);

  const monthOf = (key: string) => {
    const i = D.dateIndex(key);
    const found = months.findIndex((m) => m.idx.includes(i));
    return found < 0 ? 0 : found;
  };

  // Which month the rail is showing, which is NOT which date is selected.
  // Tapping a month moves the strip without changing the date, so a mis-tap
  // costs nothing.
  const [month, setMonth] = useState(() => monthOf(dateKey));

  // Follow the date when it changes from outside — the arrows, a deep link, or
  // the nearest-game-day chips on an off day.
  useEffect(() => {
    setMonth(monthOf(dateKey));
  }, [dateKey]);

  const stripRef = useRef<HTMLDivElement | null>(null);

  // Keep the selected day in view. Runs after paint, so the cards for a
  // freshly-switched month are laid out and `clientWidth` is real.
  useEffect(() => {
    const el = stripRef.current;
    const cells = months[month]?.idx;
    if (!el || !cells) return;

    const pos = cells.indexOf(D.dateIndex(dateKey));
    if (pos < 0) {
      el.scrollLeft = 0; // a month the selected date is not in
      return;
    }

    // Land on a whole number of cards: an unquantised offset leaves a sliver of
    // the next card past the edge, which is the thing the strip exists to avoid.
    const perView = Math.max(1, Math.floor(el.clientWidth / PITCH));
    const maxCard = Math.max(0, cells.length - perView);
    const card = Math.min(maxCard, Math.max(0, Math.round(pos - (perView - 1) / 2)));
    el.scrollLeft = card * PITCH;
  }, [month, dateKey, months, D]);

  const prevGame = stepGameDay(D, dateKey, -1);
  const nextGame = stepGameDay(D, dateKey, 1);

  const viewed = D.DATES[D.dateIndex(dateKey)];
  const dayIndex = D.dateIndex(dateKey);
  const offDay = D.NO_GAME_DAYS.has(dateKey);

  const stepBtn = (enabled: boolean) => ({
    width: 44, height: 44, display: "grid" as const, placeItems: "center" as const,
    background: C.surfaceAlt,
    border: `1px solid ${enabled ? C.lineStrong : C.raised}`,
    borderRadius: 11, color: enabled ? C.textDim : "#4a4d5c",
    cursor: enabled ? "pointer" : "default", flex: "none" as const,
  });

  return (
    <div style={{ paddingTop: 4 }}>
      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 12 }}>
        <HoverButton
          onClick={() => prevGame && onPick(prevGame)}
          style={stepBtn(!!prevGame)}
          hoverStyle={prevGame ? { borderColor: C.accentDeep } : {}}
        >
          <ChevronLeft />
        </HoverButton>

        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div
            style={{
              fontSize: 13, fontWeight: 500, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {viewed ? `${viewed.weekday}, ${viewed.long}` : ""}
          </div>
          <div style={{ fontSize: 10, color: C.textFaint }}>
            {offDay
              ? `No games · standings as of ${D.effectiveDate(dateKey)?.short ?? "—"}`
              : `Day ${dayIndex + 1} of ${D.DATES.length}`}
          </div>
        </div>

        <HoverButton
          onClick={() => nextGame && onPick(nextGame)}
          style={stepBtn(!!nextGame)}
          hoverStyle={nextGame ? { borderColor: C.accentDeep } : {}}
        >
          <ChevronRight />
        </HoverButton>
      </div>

      {/* Month rail */}
      <div style={{ display: "flex", gap: 5, paddingBottom: 10 }}>
        {months.map((m, i) => {
          const on = i === month;
          return (
            <HoverButton
              key={`${m.label}-${i}`}
              onClick={() => setMonth(i)}
              style={{
                flex: 1, minWidth: 0, height: 38, display: "grid", placeItems: "center",
                background: on ? "rgba(145,132,217,0.14)" : "transparent",
                border: `1px solid ${on ? C.accent : C.lineStrong}`,
                borderRadius: 9, color: on ? C.accentPale : C.textDim,
                fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0,
              }}
              hoverStyle={{ borderColor: C.accent }}
            >
              {m.label}
            </HoverButton>
          );
        })}
      </div>

      {/* Day strip */}
      <div
        ref={stripRef}
        className="noscroll"
        style={{
          overflowX: "auto", overflowY: "hidden",
          padding: "2px 0 4px", scrollSnapType: "x mandatory",
        }}
      >
        <div style={{ display: "flex", gap: 6, paddingRight: 6 }}>
          {(months[month]?.idx ?? []).map((i) => {
            const d = D.DATES[i];
            const off = D.NO_GAME_DAYS.has(d.key);
            const sel = d.key === dateKey;
            return (
              <HoverButton
                key={d.key}
                onClick={() => onPick(d.key)}
                title={off ? `${d.long} — no NBA games` : d.long}
                style={{
                  width: 44, height: 60, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 4,
                  background: sel ? C.accent : off ? "transparent" : C.surfaceAlt,
                  border: `1px solid ${sel ? C.accentBright : off ? C.lineStrong : C.line}`,
                  borderStyle: off && !sel ? "dashed" : "solid",
                  borderRadius: 10, cursor: "pointer", flex: "none", padding: 0,
                  scrollSnapAlign: "start",
                }}
                hoverStyle={{ borderColor: C.accent }}
              >
                <span
                  style={{
                    fontSize: 9, letterSpacing: "0.04em",
                    color: sel ? "rgba(22,24,38,0.7)" : C.textGhost,
                  }}
                >
                  {d.weekday.slice(0, 2)}
                </span>
                <span
                  style={{
                    fontSize: 16, fontVariantNumeric: "tabular-nums",
                    color: sel ? C.bg : off ? C.textFaint : C.text,
                  }}
                >
                  {dayOf(d)}
                </span>
                {/* A dot means games were played. Off days carry none, which is
                    the same distinction the ribbon draws with a dashed cell. */}
                <span
                  style={{
                    width: 4, height: 4, borderRadius: 999,
                    background: off
                      ? "transparent"
                      : sel
                        ? "rgba(22,24,38,0.55)"
                        : C.accentDeep,
                  }}
                />
              </HoverButton>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, paddingTop: 10,
        }}
      >
        <span style={{ fontSize: 10, color: C.textFaint }}>
          {`${D.DATES.length - D.NO_GAME_DAYS.size} game days · ${D.NO_GAME_DAYS.size} without games`}
        </span>
        <HoverButton
          onClick={() => onPick(D.TODAY_KEY)}
          style={{
            height: 32, padding: "0 12px", background: "transparent",
            border: `1px solid ${C.lineStrong}`, borderRadius: 9,
            color: C.textDim, fontSize: 11, cursor: "pointer",
            whiteSpace: "nowrap", flex: "none",
          }}
          hoverStyle={{ borderColor: C.accentDeep, color: C.text }}
        >
          End of season
        </HoverButton>
      </div>
    </div>
  );
}

/** The next day the NBA actually played, or null at either end of the season. */
function stepGameDay(D: DataSource, key: string, dir: 1 | -1): string | null {
  let i = D.dateIndex(key) + dir;
  while (i >= 0 && i < D.DATES.length) {
    if (!D.NO_GAME_DAYS.has(D.DATES[i].key)) return D.DATES[i].key;
    i += dir;
  }
  return null;
}
