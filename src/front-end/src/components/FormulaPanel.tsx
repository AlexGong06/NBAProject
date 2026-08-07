// The "How it works" drawer. Shows the formula with this player's numbers
// substituted in, so the score is auditable rather than a black box.

import { C, MONO, fmt, label } from "../theme";
import type { DataSource, PlayerStats } from "../data/types";
import { CloseIcon, HoverButton } from "./ui";

type Props = {
  D: DataSource;
  player: PlayerStats;
  onClose: () => void;
};

export default function FormulaPanel({ D, player, onClose }: Props) {
  const b = D.breakdown(player);

  const steps = [
    {
      id: 1,
      label: "Level of impact",
      value: fmt(b.levelOfImpact),
      expr: "(wins / games) × (MPG / 48) × (USG% / 100)",
      substituted: `(${player.teamWins} / ${player.teamGamesPlayed}) × (${player.minutesPerGame.toFixed(1)} / 48) × (${player.usageRate.toFixed(1)} / 100)`,
    },
    {
      id: 2,
      label: "Quality of impact",
      value: fmt(b.qualityOfImpact, 2),
      expr: "0.4(VORP + WS) + 0.2(BPM)",
      substituted: `0.4(${player.valueOverReplacement.toFixed(1)} + ${player.winShare.toFixed(1)}) + 0.2(${player.boxPlusMinus.toFixed(1)})`,
    },
    {
      id: 3,
      label: "Win contribution",
      value: fmt(b.winContribution),
      expr: "level of impact × quality of impact",
      substituted: `${fmt(b.levelOfImpact)} × ${fmt(b.qualityOfImpact, 2)}`,
    },
    {
      id: 4,
      label: "Total stats",
      value: fmt(b.totalStats),
      expr: "(PTS × TS% + 1.5 AST + 1.2 REB + 3 BLK + 3 STL − PF − TOV) / 25",
      substituted: `(${player.pointsPerGame.toFixed(1)} × ${player.trueShootingPercentage.toFixed(3)} + 1.5(${player.assistsPerGame.toFixed(1)}) + 1.2(${player.reboundsPerGame.toFixed(1)}) + 3(${player.blocksPerGame.toFixed(1)}) + 3(${player.stealsPerGame.toFixed(1)}) − ${player.foulsPerGame.toFixed(1)} − ${player.turnoversPerGame.toFixed(1)}) / 25`,
    },
  ];

  const mono: React.CSSProperties = {
    fontFamily: MONO, fontSize: 11.5, lineHeight: 1.7, wordBreak: "break-word",
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(12,13,22,0.6)", zIndex: 70 }}
      />
      <div
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 460,
          background: C.surfaceAlt, borderLeft: `1px solid ${C.lineStrong}`,
          zIndex: 80, overflow: "auto", padding: 28,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
          <div>
            <div style={{ ...label, color: C.accent, marginBottom: 8 }}>How it works</div>
            <h2 style={{ margin: 0, fontSize: 25, fontWeight: 500, letterSpacing: "-0.02em" }}>
              Scoring {player.player}
            </h2>
          </div>
          <HoverButton
            onClick={onClose}
            style={{
              width: 30, height: 30, display: "grid", placeItems: "center",
              background: "transparent", border: `1px solid ${C.lineStrong}`,
              borderRadius: 8, color: C.textDim, cursor: "pointer", flex: "none",
            }}
            hoverStyle={{ color: C.text, borderColor: C.accentDeep }}
          >
            <CloseIcon />
          </HoverButton>
        </div>

        <p style={{ fontSize: 13, color: C.textDim, margin: "0 0 24px", textWrap: "pretty" }}>
          Every scrape recomputes one number per player. Nothing is weighted by narrative,
          award history or team market — only the box score and the team's record.
        </p>

        {steps.map((s) => (
          <div
            key={s.id}
            style={{
              border: `1px solid ${C.line}`, borderRadius: 12,
              background: C.surfaceSunk, padding: "16px 18px", marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div style={label}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: C.accentPale }}>
                {s.value}
              </div>
            </div>
            <div style={{ ...mono, color: C.textFaint, marginTop: 10 }}>{s.expr}</div>
            <div style={{ ...mono, color: C.textMuted, marginTop: 4 }}>{s.substituted}</div>
          </div>
        ))}

        <div
          style={{
            border: `1px solid ${C.accentDark}`, borderRadius: 12,
            background: "rgba(145,132,217,0.08)", padding: 18, marginTop: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ ...label, color: C.accentBright }}>Total value</div>
            <div style={{ fontSize: 30, fontWeight: 500, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>
              {fmt(b.mvpValue)}
            </div>
          </div>
          <div style={{ ...mono, color: C.textMuted, marginTop: 8 }}>
            {`0.5 × ${fmt(b.winContribution)}  +  0.5 × ${fmt(b.totalStats)}`}
          </div>
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
          <div style={{ ...label, marginBottom: 10 }}>Known limits</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.textDim, lineHeight: 1.7 }}>
            <li>Total Stats dominates the sum for high-usage scorers.</li>
            <li>Team record is a season ratio, not a rolling window.</li>
            <li>Days the collector fails are gaps, never interpolated.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
