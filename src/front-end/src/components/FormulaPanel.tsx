// The "How it works" drawer. Shows the formula with this player's numbers
// substituted in, so the score is auditable rather than a black box.

import { C, MONO, fmt, label } from "../theme";
import type { RankedPlayer } from "../data/types";
import { CloseIcon, HoverButton } from "./ui";

type Props = {
  player: RankedPlayer;
  onClose: () => void;
};

export default function FormulaPanel({ player, onClose }: Props) {
  // Every term shown here was computed by the backend and stored on the row.
  // The panel explains the number beside it because it IS that number, rather
  // than a second calculation that happens to agree.
  const b = player;

  const steps = [
    {
      id: 1,
      label: "Level of impact",
      value: fmt(b.levelOfImpact),
      // Usage is stored as a fraction and used as the factor directly. This
      // panel used to render "(28.8 / 100)" back when the stat came from
      // Basketball Reference as a percentage; against NBA API data that same
      // string reads "(0.3 / 100)" — a panel whose whole purpose is showing the
      // working, showing the wrong working.
      expr: "(wins / games) × (MPG / 48) × USG",
      substituted: `(${player.teamWins} / ${player.teamGamesPlayed}) × (${player.minutesPerGame.toFixed(1)} / 48) × ${player.usageRate.toFixed(3)}`,
    },
    {
      id: 2,
      label: "Quality of impact",
      value: fmt(b.qualityOfImpact, 2),
      // The × 100 is shown rather than folded into the coefficient, because it
      // is the step a reader is most likely to think is missing.
      expr: "0.4(PIE × 100) + 0.2(NRTG)",
      substituted: `0.4(${player.pie.toFixed(3)} × 100) + 0.2(${player.netRating.toFixed(1)})`,
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
    {
      id: 5,
      label: "Availability",
      value: fmt(b.availability),
      expr: "games played / team games",
      substituted: `${player.gamesPlayed} / ${player.teamGamesPlayed}  —  missed ${player.teamGamesPlayed - player.gamesPlayed}`,
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
          One number per player, recomputed from every game he had played by this date.
          Nothing is weighted by narrative, award history or team market — only the box
          score and the team's record.
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
            {`${fmt(b.availability)} × (0.5 × ${fmt(b.winContribution)}  +  0.5 × ${fmt(b.totalStats)})`}
          </div>
          {b.availability < 1 && (
            <div style={{ ...mono, color: C.textFaint, marginTop: 6 }}>
              {`${fmt(b.rawValue)} at full availability — ${player.teamGamesPlayed - player.gamesPlayed} missed games cost ${fmt(b.rawValue - b.mvpValue)}`}
            </div>
          )}
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
          <div style={{ ...label, marginBottom: 10 }}>Known limits</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.textDim, lineHeight: 1.7 }}>
            <li>Total Stats dominates the sum for high-usage scorers.</li>
            <li>Team record is a season ratio, not a rolling window.</li>
            <li>Season-to-date, so early dates rest on very few games.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
