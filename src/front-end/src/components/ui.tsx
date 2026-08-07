// Small primitives shared by every view.
//
// The mockup leans on hover states throughout. Inline React styles can't express
// :hover, so Hover* keeps a tiny bit of local state and merges a second style
// object on mouse-over. That keeps everything in one place instead of splitting
// each component across a stylesheet.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

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

export const ExternalIcon = ({ size = 11, color }: IconProps) =>
  svg(size, color, "M216 104a8 8 0 01-16 0V59.31l-98.34 98.35a8 8 0 01-11.32-11.32L188.69 48H144a8 8 0 010-16h64a8 8 0 018 8zm-24 40a8 8 0 00-8 8v56H56V80h56a8 8 0 000-16H56a16 16 0 00-16 16v128a16 16 0 0016 16h128a16 16 0 0016-16v-56a8 8 0 00-8-8z");
