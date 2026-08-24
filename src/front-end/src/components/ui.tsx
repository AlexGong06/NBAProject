// Small primitives shared by every view.
//
// The mockup leans on hover states throughout. Inline React styles can't express
// :hover, so Hover* keeps a tiny bit of local state and merges a second style
// object on mouse-over. That keeps everything in one place instead of splitting
// each component across a stylesheet.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { C } from "../theme";

type HoverProps = {
  style?: CSSProperties;
  hoverStyle?: CSSProperties;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  title?: string;
  children?: ReactNode;
};

export function HoverButton({
  style, hoverStyle, onClick, onMouseEnter, onMouseLeave, title, children,
}: HoverProps) {
  const [hot, setHot] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => { setHot(true); onMouseEnter?.(); }}
      onMouseLeave={() => { setHot(false); onMouseLeave?.(); }}
      style={{ font: "inherit", ...style, ...(hot ? hoverStyle : null) }}
    >
      {children}
    </button>
  );
}

export function HoverBox({
  style, hoverStyle, onClick, onMouseEnter, onMouseLeave, children,
}: HoverProps) {
  const [hot, setHot] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => { setHot(true); onMouseEnter?.(); }}
      onMouseLeave={() => { setHot(false); onMouseLeave?.(); }}
      style={{ ...style, ...(hot ? hoverStyle : null) }}
    >
      {children}
    </div>
  );
}

/* ── Player headshot ─────────────────────────────────────────────────────── */

/**
 * A player's photo over his initials.
 *
 * The initials are rendered first and always, and the image sits on top of
 * them. That ordering is the whole design: an id that yields no photo, a CDN
 * that is slow, or an offline reload all end with the initials showing — never
 * a broken-image glyph in a circle, and never a gap that shifts the layout
 * while the photo loads.
 *
 * `src` comes from `headshotUrl()` and is null when no player id could be
 * recovered from the row, in which case no request is made at all.
 */
export function Headshot({
  src, initials, size, fontSize,
}: {
  src: string | null;
  initials: string;
  size: number;
  fontSize: number;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <>
      <span
        style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          fontSize, fontWeight: 500, color: C.textFaint,
        }}
      >
        {initials}
      </span>
      {src && !failed && (
        <img
          src={src}
          alt={initials}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            position: "absolute", inset: 0, width: size, height: size,
            // The source is 260x190 and off-centre — the NBA crops these with
            // the head high in a wide frame. `cover` plus a top-biased origin
            // is what puts the face in the circle instead of the chin.
            objectFit: "cover", objectPosition: "50% 12%",
            display: "block", pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}

/* ── Team logo ───────────────────────────────────────────────────────────── */

/**
 * A team's mark on a disc, falling back to its abbreviation.
 *
 * Same ordering as `<Headshot>`: the text is rendered first and always, the
 * image sits on top of it, and `onError` drops the image. A team without a
 * resolvable id, or a CDN that is slow, ends with a readable "GSW" rather than
 * a broken-image glyph.
 *
 * `dim` is for the opponent's disc — one step back, so the player's own team
 * reads as the subject of the row rather than the two sitting at equal weight.
 */
export function TeamLogo({
  src, abbr, size, dim = false, labelled = true,
}: {
  src: string | null;
  abbr: string;
  size: number;
  dim?: boolean;
  /**
   * Draw the abbreviation inside the disc as the fallback.
   *
   * Pass false where the abbreviation is already printed next to the disc — the
   * last-game chip does exactly that — or a failed logo renders "GSW" twice
   * side by side.
   */
  labelled?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  // Barely any inset. `objectFit: contain` already keeps the mark inside the
  // box, and these SVGs carry their own internal whitespace — a 14% pad on top
  // of that left an 18px disc showing a 13px logo, which at this size reads as
  // a smudge. 1px is enough to keep the artwork off the border.
  const pad = 1;

  // With `labelled={false}` the abbreviation is already printed beside the
  // disc, so the mark is decorative: no title, empty alt, hidden from the
  // accessibility tree. Otherwise a chip announces "OKC OKC 136-104 CLE CLE".
  const decorative = !labelled;

  return (
    <span
      title={decorative ? undefined : abbr}
      aria-hidden={decorative || undefined}
      style={{
        position: "relative", width: size, height: size, borderRadius: 999,
        background: dim ? C.oppDisc : C.raised,
        border: `1px solid ${dim ? C.oppDiscLine : C.lineStrong}`,
        display: "block", flex: "none", overflow: "hidden",
      }}
    >
      {labelled && (
        <span
          style={{
            position: "absolute", inset: 0, display: "grid", placeItems: "center",
            fontSize: Math.max(7, Math.round(size * 0.36)),
            fontWeight: 600, letterSpacing: "-0.02em",
            color: dim ? C.textGhost : C.textFaint,
          }}
        >
          {abbr}
        </span>
      )}
      {src && !failed && (
        <img
          src={src}
          alt={decorative ? "" : abbr}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            position: "absolute", inset: pad,
            width: size - pad * 2, height: size - pad * 2,
            objectFit: "contain", display: "block", pointerEvents: "none",
          }}
        />
      )}
    </span>
  );
}

/* ── Icons (Phosphor paths, matching the mockup) ─────────────────────────── */

type IconProps = { size?: number; color?: string };

const svg = (size: number, color: string | undefined, d: string) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill={color ?? "currentColor"}>
    <path d={d} />
  </svg>
);

export const SearchIcon = ({ size = 14, color }: IconProps) =>
  svg(size, color, "M229.66 218.34l-50.07-50.06a88.11 88.11 0 10-11.31 11.31l50.06 50.07a8 8 0 0011.32-11.32zM40 112a72 72 0 1172 72 72.08 72.08 0 01-72-72z");

export const ChevronLeft = ({ size = 14, color }: IconProps) =>
  svg(size, color, "M165.66 202.34a8 8 0 01-11.32 11.32l-80-80a8 8 0 010-11.32l80-80a8 8 0 0111.32 11.32L91.31 128z");

export const ChevronRight = ({ size = 14, color }: IconProps) =>
  svg(size, color, "M181.66 133.66l-80 80a8 8 0 01-11.32-11.32L164.69 128 90.34 53.66a8 8 0 0111.32-11.32l80 80a8 8 0 010 11.32z");

export const ChevronDown = ({ size = 12, color }: IconProps) =>
  svg(size, color, "M213.66 101.66l-80 80a8 8 0 01-11.32 0l-80-80a8 8 0 0111.32-11.32L128 164.69l74.34-74.35a8 8 0 0111.32 11.32z");

export const ChevronUp = ({ size = 12, color }: IconProps) =>
  svg(size, color, "M213.66 165.66a8 8 0 01-11.32 0L128 91.31l-74.34 74.35a8 8 0 01-11.32-11.32l80-80a8 8 0 0111.32 0l80 80a8 8 0 010 11.32z");

export const ArrowLeft = ({ size = 13, color }: IconProps) =>
  svg(size, color, "M224 128a8 8 0 01-8 8H59.31l58.35 58.34a8 8 0 01-11.32 11.32l-72-72a8 8 0 010-11.32l72-72a8 8 0 0111.32 11.32L59.31 120H216a8 8 0 018 8z");

export const CloseIcon = ({ size = 12, color }: IconProps) =>
  svg(size, color, "M205.66 194.34a8 8 0 01-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 01-11.32-11.32L116.69 128 50.34 61.66a8 8 0 0111.32-11.32L128 116.69l66.34-66.35a8 8 0 0111.32 11.32L139.31 128z");

export const WarningIcon = ({ size = 20, color }: IconProps) =>
  svg(size, color, "M128 24a104 104 0 10104 104A104.11 104.11 0 00128 24zm0 192a88 88 0 1188-88 88.1 88.1 0 01-88 88zm-8-80V80a8 8 0 0116 0v56a8 8 0 01-16 0zm20 36a12 12 0 11-12-12 12 12 0 0112 12z");

export const PlayIcon = ({ size = 14, color }: IconProps) =>
  svg(size, color, "M232.4 114.49L88.32 26.35a16 16 0 00-16.2-.3A15.86 15.86 0 0064 39.87v176.26A15.94 15.94 0 0080 232a16.07 16.07 0 008.36-2.35l144.04-88.14a15.81 15.81 0 000-27.02z");

export const ChartLineIcon = ({ size = 14, color }: IconProps) =>
  svg(size, color, "M232 208a8 8 0 01-8 8H32a8 8 0 01-8-8V48a8 8 0 0116 0v110.06l50.34-50.35a8 8 0 0111.32 0L128 148l50.34-50.34L156.69 76a8 8 0 015.65-13.66h56a8 8 0 018 8v56a8 8 0 01-13.66 5.66L196 110.34l-56 56a8 8 0 01-11.31 0L96 133.66l-56 56V200h184a8 8 0 018 8z");

export const ExternalIcon = ({ size = 11, color }: IconProps) =>
  svg(size, color, "M216 104a8 8 0 01-16 0V59.31l-98.34 98.35a8 8 0 01-11.32-11.32L188.69 48H144a8 8 0 010-16h64a8 8 0 018 8zm-24 40a8 8 0 00-8 8v56H56V80h56a8 8 0 000-16H56a16 16 0 00-16 16v128a16 16 0 0016 16h128a16 16 0 0016-16v-56a8 8 0 00-8-8z");
