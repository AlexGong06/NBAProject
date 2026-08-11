import { useState } from "react";
import { C, LEAGUE_NOTES, deltaLabel, fmt, initials, label, statList, tabular } from "../theme";
import { mainChart } from "../charts";
import type { ChartMode } from "../charts";
import type { DataSource } from "../data/types";
import { ArrowLeft, ExternalIcon, HoverButton } from "./ui";

type Props = {
  D: DataSource;
  playerName: string;
  dateKey: string;
  onBack: () => void;
  onOpenPlayer: (name: string) => void;
  onTogglePanel: () => void;
  onToast: (msg: string) => void;
};

const MODES: { id: ChartMode; label: string }[] = [
  { id: "rank", label: "Rank" },
  { id: "score", label: "Value" },
  { id: "field", label: "Field" },
];

const RANGES = [7, 14, 30];

export default function PlayerProfileView({
  D, playerName, dateKey, onBack, onOpenPlayer, onTogglePanel, onToast,
}: Props) {
  const [mode, setMode] = useState<ChartMode>("rank");
  const [range, setRange] = useState(14);

  const p = D.findPlayer(playerName) ?? D.PLAYERS[0];
  const todayRows = D.rankings(D.TODAY_KEY) ?? [];
  const todayRow = todayRows.find((r) => r.player === p.player) ?? todayRows[0];
  // The row already carries every term of the formula — read it, never recompute.
  const b = todayRow ?? p;
  const totalHalf = b.winContribution + b.totalStats;

  const hist = D.history(p.player, D.TODAY_KEY, 30).filter((x) => x.rank != null);
  const peak = hist.length ? Math.min(...hist.map((x) => x.rank as number)) : null;

  const chart = mainChart(D, p.player, dateKey, range, mode);
  const games = D.nextGames(p.player);

  const wcPct = ((b.winContribution / totalHalf) * 100).toFixed(1);
  const tsPct = ((b.totalStats / totalHalf) * 100).toFixed(1);

  const segBtn = (active: boolean): React.CSSProperties => ({
    height: 30, padding: "0 12px",
    background: active ? "#2b2741" : "transparent",
    border: 0, borderRight: `1px solid ${C.line}`,
    color: active ? C.accentPale : C.textDim,
    fontSize: 12, cursor: "pointer",
  });

  return (
    <div style={{ padding: "28px 40px 72px" }}>
      <HoverButton
        onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "none", border: 0, padding: 0,
          color: C.textDim, fontSize: 13, cursor: "pointer", marginBottom: 24,
        }}
        hoverStyle={{ color: C.text }}
      >
        <ArrowLeft />
        Back to rankings
      </HoverButton>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid", gridTemplateColumns: "132px minmax(0, 1fr) auto",
          gap: 28, alignItems: "center", paddingBottom: 28,
          borderBottom: `1px solid ${C.lineFaint}`,
        }}
      >
        <div
          style={{
            width: 132, height: 132, borderRadius: 999, background: C.raised,
            border: `1px solid ${C.lineStrong}`, display: "grid", placeItems: "center",
          }}
        >
          <span style={{ fontSize: 34, fontWeight: 500, color: C.textFaint }}>{initials(p.player)}</span>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginBottom: 8 }}>
            {D.TEAMS[p.team] ?? p.team}
          </div>
          <h1 style={{ margin: 0, fontSize: 46, fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.02 }}>
            {p.player}
          </h1>
          <div style={{ marginTop: 10, fontSize: 13, color: C.textDim }}>
            {[
              p.pos,
              p.age != null ? `Age ${p.age}` : null,
              `${p.teamWins}–${p.teamLosses}`,
              `${p.gamesPlayed}/${p.teamGamesPlayed} games`,
              `${p.minutesPerGame.toFixed(1)} MPG`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>

        <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>
              Rank today
            </div>
            <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.05, ...tabular, color: C.accentPale }}>
              {todayRow ? `#${todayRow.calculatedRank}` : "—"}
            </div>
            <div style={{ fontSize: 11, color: C.textFaint }}>
              {todayRow ? deltaLabel(todayRow.delta) : ""}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>
              MVP value
            </div>
            <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.05, ...tabular }}>
              {todayRow ? fmt(todayRow.mvpValue) : fmt(b.mvpValue)}
            </div>
            <div style={{ fontSize: 11, color: C.textFaint }}>
              {peak ? `Peak #${peak} in 30 days` : ""}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 40, paddingTop: 32 }}>
        <div style={{ minWidth: 0 }}>
          {/* ── Chart ───────────────────────────────────────────────── */}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: "22px 24px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.015em" }}>{chart.title}</div>
                <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3 }}>{chart.subtitle}</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ display: "flex", border: `1px solid ${C.lineStrong}`, borderRadius: 8, overflow: "hidden" }}>
                  {MODES.map((m) => (
                    <button key={m.id} type="button" onClick={() => setMode(m.id)} style={segBtn(mode === m.id)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", border: `1px solid ${C.lineStrong}`, borderRadius: 8, overflow: "hidden" }}>
                  {RANGES.map((r) => (
                    <button key={r} type="button" onClick={() => setRange(r)} style={segBtn(range === r)}>
                      {r === 30 ? "1M" : `${r}D`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <svg width="100%" viewBox="0 0 820 300" style={{ display: "block", overflow: "visible" }}>
              {chart.grid.map((g) => (
                <line key={`l${g.id}`} x1={g.x1} y1={g.y} x2={g.x2} y2={g.y} stroke={C.raised} strokeWidth={1} />
              ))}
              {chart.grid.map((g) => (
                <text key={`gt${g.id}`} x={0} y={g.ty} fill={C.textFaint} fontSize={10}>{g.label}</text>
              ))}
              {/* Shaded bands where the collector produced nothing. */}
              {chart.missing.map((m) => (
                <rect key={`m${m.id}`} x={m.x} y={8} width={m.w} height={238} fill="#20222f" opacity={0.85} />
              ))}
              {chart.missing.map((m) => (
                <text key={`mt${m.id}`} x={m.tx} y={262} fill={C.textGhost} fontSize={9} textAnchor="middle">
                  no scrape
                </text>
              ))}
              {chart.gaps.map((s) => (
                <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={1.6} strokeDasharray="3 4" opacity={0.6} />
              ))}
              {chart.segments.map((s) => (
                <polyline key={s.id} points={s.points} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {chart.dots.map((d) => (
                <circle key={d.id} cx={d.x} cy={d.y} r={d.r} fill={C.bg} stroke={d.color} strokeWidth={1.6} />
              ))}
              {chart.ends.map((e) => (
                <text key={e.id} x={e.tx} y={e.ty} fill={e.color} fontSize={10}>{e.label}</text>
              ))}
              {chart.xTicks.map((t) => (
                <text key={t.id} x={t.x} y={286} fill={C.textGhost} fontSize={10} textAnchor="middle">{t.label}</text>
              ))}
            </svg>
          </div>

          {/* ── Season averages ─────────────────────────────────────── */}
          <div style={{ marginTop: 28 }}>
            <div style={{ ...label, marginBottom: 14 }}>
              Season averages · {p.teamGamesPlayed} team games
            </div>
            <div
              style={{
                display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1,
                background: C.line, border: `1px solid ${C.line}`,
                borderRadius: 12, overflow: "hidden",
              }}
            >
              {statList(p).map((s) => (
                <div key={s.label} style={{ background: C.surface, padding: "16px 14px" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 500, ...tabular, letterSpacing: "-0.02em", marginTop: 4 }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 10, color: C.textFaint, marginTop: 2 }}>
                    {LEAGUE_NOTES[s.label] ?? ""}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Schedule (fixture mode only; no API endpoint yet) ───── */}
          {games.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.015em" }}>Next 10 games</div>
                <div style={{ fontSize: 12, color: C.textFaint }}>Tickets via partner marketplaces</div>
              </div>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid", gridTemplateColumns: "96px 44px minmax(0, 1fr) 96px 104px 116px",
                    gap: 14, alignItems: "center", padding: "10px 18px",
                    background: C.surfaceSunk, borderBottom: `1px solid ${C.line}`,
                    fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost,
                  }}
                >
                  <div>Date</div><div /><div>Opponent</div><div>Tip</div><div>From</div><div />
                </div>
                {games.map((g) => (
                  <div
                    key={g.id}
                    style={{
                      display: "grid", gridTemplateColumns: "96px 44px minmax(0, 1fr) 96px 104px 116px",
                      gap: 14, alignItems: "center", padding: "12px 18px",
                      background: C.surface, borderBottom: `1px solid ${C.raised}`,
                    }}
                  >
                    <div style={{ fontSize: 13, color: C.textMuted, ...tabular }}>
                      {g.weekday} {g.dateShort}
                    </div>
                    <div
                      style={{
                        width: 34, height: 34, borderRadius: 8, background: C.raised,
                        border: `1px solid ${C.lineStrong}`, display: "grid", placeItems: "center",
                        fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", color: C.textDim,
                      }}
                    >
                      {g.opp}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {(g.home ? "vs " : "at ") + g.oppName}
                      </div>
                      <div style={{ fontSize: 11, color: C.textFaint }}>
                        {g.home ? "Home" : `Away · ${g.oppName.split(" ").slice(0, -1).join(" ")}`}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: C.textDim, ...tabular }}>{g.tip}</div>
                    <div style={{ fontSize: 14, ...tabular }}>${g.priceFrom}</div>
                    <HoverButton
                      onClick={() => onToast(`Opening tickets for ${p.team} ${g.vs} ${g.opp} — ${g.dateShort}`)}
                      style={{
                        height: 30, padding: "0 12px", background: "transparent",
                        border: `1px solid ${C.accentDeep}`, borderRadius: 8,
                        color: C.accentPale, fontSize: 12, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center",
                      }}
                      hoverStyle={{ background: C.accentWash, borderColor: C.accent }}
                    >
                      Tickets
                      <ExternalIcon />
                    </HoverButton>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Profile rail ────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              border: `1px solid ${C.lineStrong}`, borderRadius: 14,
              background: "linear-gradient(160deg, #262838 0%, #1c1e2b 70%)", padding: 22,
            }}
          >
            <div style={{ ...label, marginBottom: 16 }}>Score composition</div>
            <svg width="100%" height={12} style={{ display: "block" }}>
              <rect x={0} y={0} width="100%" height={12} rx={6} fill={C.line} />
              <rect x={0} y={0} width={`${wcPct}%`} height={12} rx={6} fill={C.accent} />
              <rect x={`${wcPct}%`} y={0} width={`${tsPct}%`} height={12} fill={C.accentDeep} />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textMuted }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: C.accent }} />
                  Win contribution
                </span>
                <span style={{ fontSize: 15, ...tabular }}>{fmt(b.winContribution)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textMuted }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: C.accentDeep }} />
                  Total stats
                </span>
                <span style={{ fontSize: 15, ...tabular }}>{fmt(b.totalStats)}</span>
              </div>
            </div>
            <HoverButton
              onClick={onTogglePanel}
              style={{
                width: "100%", height: 34, marginTop: 20, background: "transparent",
                border: `1px solid ${C.accentDeep}`, borderRadius: 8,
                color: C.accentPale, fontSize: 13, cursor: "pointer",
              }}
              hoverStyle={{ background: C.accentWash, borderColor: C.accent }}
            >
              See the math
            </HoverButton>
          </div>

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 22 }}>
            <div style={{ ...label, marginBottom: 14 }}>Field position</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {todayRows.map((r) => {
                const isSel = r.player === p.player;
                return (
                  <HoverButton
                    key={r.player}
                    onClick={() => onOpenPlayer(r.player)}
                    style={{
                      display: "grid", gridTemplateColumns: "26px minmax(0, 1fr) auto",
                      gap: 12, alignItems: "center", textAlign: "left",
                      background: isSel ? C.raised : "transparent",
                      border: 0, borderRadius: 8, padding: "9px 10px",
                      cursor: "pointer", color: isSel ? C.text : C.textDim,
                    }}
                    hoverStyle={{ background: C.raised }}
                  >
                    <span style={{ fontSize: 12, color: C.textGhost, ...tabular }}>#{r.calculatedRank}</span>
                    <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.player}
                    </span>
                    <span style={{ fontSize: 13, ...tabular, color: C.textDim }}>{fmt(r.mvpValue)}</span>
                  </HoverButton>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
