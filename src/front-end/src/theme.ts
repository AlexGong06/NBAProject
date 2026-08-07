// Design tokens from the Claude Design mockup (NBA MVP Tracking UI).

export const C = {
  bg: "#161826",
  bgDeep: "#101220",
  surface: "#1a1c29",
  surfaceAlt: "#1c1e2b",
  surfaceSunk: "#171924",
  raised: "#232532",
  raisedAlt: "#262838",
  line: "#292b31",
  lineStrong: "#3f424d",
  lineFaint: "rgba(233,233,237,0.16)",

  text: "#e9e9ed",
  textMuted: "#b2b6ca",
  textDim: "#9397ab",
  textFaint: "#75798c",
  textGhost: "#595d6c",

  accent: "#9184d9",
  accentBright: "#b5abfc",
  accentPale: "#d2cefd",
  accentDeep: "#5d5294",
  accentMid: "#796cbf",
  accentDark: "#423a6a",
  accentWash: "rgba(145,132,217,0.12)",
} as const;

/** Line colours for the multi-player "field" chart, most prominent first. */
export const LINE_COLORS = [C.accentBright, "#a7a1db", "#9690c9", "#7972a9", "#5c5783"];

export const FONT =
  "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
export const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const label: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  color: C.textFaint,
};

export const card: React.CSSProperties = {
  border: `1px solid ${C.line}`,
  borderRadius: 14,
  background: C.surface,
};

export const tabular: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

export function deltaLabel(d: number): string {
  if (d > 0) return `▲ ${d} since last scrape`;
  if (d < 0) return `▼ ${Math.abs(d)} since last scrape`;
  return "— no change";
}

export function deltaShort(d: number): string {
  if (d > 0) return `▲ ${d}`;
  if (d < 0) return `▼ ${Math.abs(d)}`;
  return "— even";
}

export const LEAGUE_NOTES: Record<string, string> = {
  PTS: "per game", AST: "per game", REB: "per game", BLK: "per game",
  STL: "per game", MIN: "per game", "USG%": "possessions used",
  "TS%": "true shooting", VORP: "value over replacement",
  WS: "win shares", BPM: "box plus/minus", TOV: "per game",
};

export function statList(p: {
  pointsPerGame: number; assistsPerGame: number; reboundsPerGame: number;
  blocksPerGame: number; stealsPerGame: number; minutesPerGame: number;
  usageRate: number; trueShootingPercentage: number;
  valueOverReplacement: number; winShare: number; boxPlusMinus: number;
  turnoversPerGame: number;
}) {
  return [
    { label: "PTS", value: p.pointsPerGame.toFixed(1) },
    { label: "AST", value: p.assistsPerGame.toFixed(1) },
    { label: "REB", value: p.reboundsPerGame.toFixed(1) },
    { label: "BLK", value: p.blocksPerGame.toFixed(1) },
    { label: "STL", value: p.stealsPerGame.toFixed(1) },
    { label: "MIN", value: p.minutesPerGame.toFixed(1) },
    { label: "USG%", value: p.usageRate.toFixed(1) },
    { label: "TS%", value: (p.trueShootingPercentage * 100).toFixed(1) },
    { label: "VORP", value: p.valueOverReplacement.toFixed(1) },
    { label: "WS", value: p.winShare.toFixed(1) },
    { label: "BPM", value: p.boxPlusMinus.toFixed(1) },
    { label: "TOV", value: p.turnoversPerGame.toFixed(1) },
  ];
}
