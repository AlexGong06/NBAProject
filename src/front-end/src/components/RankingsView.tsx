import { useState } from "react";
import { C, MONO, deltaLabel, deltaShort, fmt, initials, label, statList, tabular } from "../theme";
import { bumpChart, sparkline } from "../charts";
import type { DataSource, RankedPlayer } from "../data/types";
import ScrapeRibbon from "./ScrapeRibbon";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, HoverBox, HoverButton, WarningIcon,
} from "./ui";

type Props = {
  D: DataSource;
  dateKey: string;
  topN: number;
  onPickDate: (key: string) => void;
  onOpenPlayer: (name: string) => void;
  onTogglePanel: () => void;
};

/** Split bar showing how much of a score came from winning vs raw production. */
function SplitBar({ wcPct, tsPct, height, fills }: {
  wcPct: number; tsPct: number; height: number; fills: [string, string, string];
}) {
  return (
    <svg width="100%" height={height} style={{ display: "block" }}>
      <rect x={0} y={0} width="100%" height={height} rx={height / 2} fill={fills[0]} />
      <rect x={0} y={0} width={`${wcPct}%`} height={height} rx={height / 2} fill={fills[1]} />
      <rect x={`${wcPct}%`} y={0} width={`${tsPct}%`} height={height} fill={fills[2]} />
    </svg>
  );
}

export default function RankingsView({
  D, dateKey, topN, onPickDate, onOpenPlayer, onTogglePanel,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const snap = D.snapshot(dateKey);
  const rows = D.rankings(dateKey);
  const hasData = !!rows;

  const idx = D.dateIndex(dateKey);
  const prevDay = () => idx > 0 && onPickDate(D.DATES[idx - 1].key);
  const nextDay = () => idx < D.DATES.length - 1 && onPickDate(D.DATES[idx + 1].key);

  const stepBtn: React.CSSProperties = {
    width: 34, height: 34, display: "grid", placeItems: "center",
    background: C.surfaceAlt, border: `1px solid ${C.lineStrong}`,
    borderRadius: 8, color: C.textDim, cursor: "pointer",
  };

  const decorate = (p: RankedPlayer, maxScore: number) => {
    const total = p.winContribution + p.totalStats;
    const scale = (p.mvpValue / maxScore) * 100;
    return {
      total,
      wcPct: Number(((p.winContribution / total) * scale).toFixed(1)),
      tsPct: Number(((p.totalStats / total) * scale).toFixed(1)),
      splitLabel:
        `${Math.round((p.winContribution / total) * 100)}% win · ` +
        `${Math.round((p.totalStats / total) * 100)}% stats`,
      meta:
        `${D.TEAMS[p.team] ?? p.team} · ${p.teamWins}–${p.teamGamesPlayed - p.teamWins} · ` +
        // Rows scraped before `pos` existed carry null; drop the segment rather
        // than rendering the word "null" between two real values.
        [p.pos, `${p.pointsPerGame.toFixed(1)}/${p.reboundsPerGame.toFixed(1)}/${p.assistsPerGame.toFixed(1)}`]
          .filter(Boolean)
          .join(" · "),
    };
  };

  const hero = hasData ? rows[0] : null;
  const rest = hasData ? rows.slice(1, topN) : [];
  const maxScore = hasData ? rows[0].mvpValue : 1;
  const bump = bumpChart(D, dateKey);

  // How often the leader actually held the top spot recently, counted from the
  // data rather than asserted.
  const heroStreak = (() => {
    if (!hero) return "";
    const pts = D.history(hero.player, dateKey, 14).filter((p) => p.rank != null);
    const held = pts.filter((p) => p.rank === 1).length;
    return `Held #1 for ${held} of the last ${pts.length} scrapes`;
  })();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 48, padding: "40px 40px 72px" }}>
      {/* ── Main column ─────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 28 }}>
          <div>
            <div style={{ ...label, marginBottom: 10 }}>Daily leaderboard</div>
            <h1 style={{ margin: 0, fontSize: 42, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              {snap ? snap.date.long : ""}
            </h1>
            <div style={{ marginTop: 8, fontSize: 13, color: C.textDim }}>
              {hasData
                ? `Top ${topN} of ${D.PLAYERS.length} tracked · total value = availability × (0.5 win contribution + 0.5 total stats)`
                : "The collector did not run on this date"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <HoverButton onClick={prevDay} style={stepBtn} hoverStyle={{ borderColor: C.accentDeep, color: C.text }}>
              <ChevronLeft />
            </HoverButton>
            <HoverButton onClick={nextDay} style={stepBtn} hoverStyle={{ borderColor: C.accentDeep, color: C.text }}>
              <ChevronRight />
            </HoverButton>
            <HoverButton
              onClick={() => onPickDate(D.TODAY_KEY)}
              style={{
                height: 34, padding: "0 14px", background: "transparent",
                border: `1px solid ${C.lineStrong}`, borderRadius: 8,
                color: C.textDim, fontSize: 13, cursor: "pointer",
              }}
              hoverStyle={{ borderColor: C.accentDeep, color: C.text }}
            >
              Today
            </HoverButton>
          </div>
        </div>

        <ScrapeRibbon D={D} dateKey={dateKey} onPick={onPickDate} />

        {/* ── Empty state: the collector failed on this day ───────────── */}
        {!hasData && (
          <div
            style={{
              border: `1px dashed ${C.lineStrong}`, borderRadius: 14,
              background: C.surface, padding: "48px 40px",
            }}
          >
            <div
              style={{
                width: 44, height: 44, borderRadius: 10, border: `1px solid ${C.accentDark}`,
                display: "grid", placeItems: "center", color: C.accent, marginBottom: 20,
              }}
            >
              <WarningIcon />
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 25, fontWeight: 500, letterSpacing: "-0.015em" }}>
              No scrape ran on {snap ? snap.date.long : dateKey}
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 14, color: C.textDim, maxWidth: "52ch", textWrap: "pretty" }}>
              The collector returned no rows for this date, so there is no ranking to compute.
              Historical days are never backfilled — pick the nearest day with data.
            </p>
            <div style={{ ...label, marginBottom: 10 }}>Nearest days with data</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {D.nearestWithData(dateKey, 4).map((d) => (
                <HoverButton
                  key={d.key}
                  onClick={() => onPickDate(d.key)}
                  style={{
                    height: 34, padding: "0 14px", background: "transparent",
                    border: `1px solid ${C.accentDeep}`, borderRadius: 8,
                    color: C.accentPale, fontSize: 13, cursor: "pointer",
                  }}
                  hoverStyle={{ background: C.accentWash }}
                >
                  {d.long}
                </HoverButton>
              ))}
            </div>
            <div
              style={{
                marginTop: 28, paddingTop: 20, borderTop: `1px solid ${C.line}`,
                fontFamily: MONO, fontSize: 11, color: C.textGhost,
              }}
            >
              GET /daily-mvp-rankings/{dateKey} → 404
            </div>
          </div>
        )}

        {/* ── Hero: rank 1 ────────────────────────────────────────────── */}
        {hero && (() => {
          const d = decorate(hero, maxScore);
          const sp = sparkline(D, hero.player, dateKey, 140, 34);
          return (
            <div
              style={{
                border: `1px solid ${C.lineStrong}`, borderRadius: 14,
                background: "linear-gradient(160deg, #262838 0%, #1c1e2b 62%)",
                padding: 28, display: "grid",
                gridTemplateColumns: "104px minmax(0, 1fr) 200px",
                gap: 28, alignItems: "center",
                boxShadow: "0 16px 40px rgba(0,0,0,0.45)", marginBottom: 20,
              }}
            >
              <HoverBox
                onClick={() => onOpenPlayer(hero.player)}
                style={{
                  position: "relative", width: 104, height: 104, borderRadius: 999,
                  background: C.line, border: `1px solid ${C.lineStrong}`,
                  display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden",
                }}
              >
                <span style={{ fontSize: 26, fontWeight: 500, color: C.textFaint, letterSpacing: "0.02em" }}>
                  {initials(hero.player)}
                </span>
              </HoverBox>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent }}>
                    Rank 01
                  </span>
                  <span style={{ width: 28, height: 1, background: C.accent }} />
                  <span style={{ fontSize: 11, letterSpacing: "0.06em", color: C.textFaint }}>
                    {heroStreak}
                  </span>
                </div>
                <HoverBox
                  onClick={() => onOpenPlayer(hero.player)}
                  style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1, cursor: "pointer" }}
                  hoverStyle={{ color: C.accentPale }}
                >
                  {hero.player}
                </HoverBox>
                <div style={{ marginTop: 6, fontSize: 13, color: C.textDim }}>{d.meta}</div>
                <div style={{ marginTop: 18 }}>
                  <SplitBar wcPct={d.wcPct} tsPct={d.tsPct} height={10} fills={[C.line, C.accent, C.accentDeep]} />
                  <div style={{ display: "flex", gap: 22, marginTop: 10, fontSize: 11, color: C.textDim }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: C.accent }} />
                      Win contribution {fmt(hero.winContribution)}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: C.accentDeep }} />
                      Total stats {fmt(hero.totalStats)}
                    </span>
                    {/* Without this the two figures above do not reconcile with the
                        MVP value shown alongside them — availability is the gap. */}
                    {hero.availability < 1 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 7, color: C.textFaint }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: C.line }} />
                        {`× ${fmt(hero.availability)} availability (${hero.gamesPlayed}/${hero.teamGamesPlayed})`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>
                  MVP value
                </div>
                <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.05, ...tabular, marginTop: 4 }}>
                  {fmt(hero.mvpValue)}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: C.textDim }}>{deltaLabel(hero.delta)}</div>
                <div style={{ marginTop: 14 }}>
                  <svg width={140} height={34} viewBox="0 0 140 34" style={{ display: "block", marginLeft: "auto", overflow: "visible" }}>
                    <polyline points={sp.points} fill="none" stroke={C.accentBright} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={sp.x} cy={sp.y} r={2.5} fill={C.accentBright} />
                  </svg>
                  <div style={{ fontSize: 10, color: C.textGhost, marginTop: 4 }}>Rank, 14 days</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Rows 2..N ───────────────────────────────────────────────── */}
        {rest.map((p) => {
          const d = decorate(p, maxScore);
          const sp = sparkline(D, p.player, dateKey, 140, 30);
          const isOpen = expanded === p.player;
          return (
            <div
              key={p.player}
              style={{
                border: `1px solid ${C.line}`, borderRadius: 12,
                background: C.surface, marginBottom: 10, overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "34px 56px minmax(180px, 1fr) 120px 150px 92px 34px",
                  alignItems: "center", gap: 16, padding: "14px 18px",
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 500, color: C.textFaint, ...tabular }}>
                  {String(p.calculatedRank).padStart(2, "0")}
                </div>

                <HoverBox
                  onClick={() => onOpenPlayer(p.player)}
                  onMouseEnter={() => setHover(p.player)}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    position: "relative", width: 52, height: 52, borderRadius: 999,
                    background: C.raised, border: `1px solid ${C.lineStrong}`,
                    display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden",
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.textFaint }}>{initials(p.player)}</span>
                  {hover === p.player && (
                    <div
                      style={{
                        position: "absolute", inset: 0, background: "rgba(22,24,38,0.88)",
                        display: "grid", placeItems: "center", textAlign: "center",
                      }}
                    >
                      <span style={{ fontSize: 8, lineHeight: 1.25, letterSpacing: "0.06em", textTransform: "uppercase", color: C.accentPale }}>
                        View profile
                      </span>
                    </div>
                  )}
                </HoverBox>

                <div style={{ minWidth: 0 }}>
                  <HoverBox
                    onClick={() => onOpenPlayer(p.player)}
                    style={{
                      fontSize: 17, fontWeight: 500, letterSpacing: "-0.01em", cursor: "pointer",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                    hoverStyle={{ color: C.accentPale }}
                  >
                    {p.player}
                  </HoverBox>
                  <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>{d.meta}</div>
                </div>

                <div>
                  <svg width="100%" height={30} viewBox="0 0 140 30" style={{ display: "block", overflow: "visible" }}>
                    <polyline points={sp.points} fill="none" stroke={C.textFaint} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={sp.x} cy={sp.y} r={2.5} fill={C.accentBright} />
                  </svg>
                </div>

                <div>
                  <SplitBar wcPct={d.wcPct} tsPct={d.tsPct} height={8} fills={[C.raised, C.accentMid, C.accentDark]} />
                  <div style={{ fontSize: 10, color: C.textGhost, marginTop: 6 }}>{d.splitLabel}</div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 500, ...tabular, letterSpacing: "-0.02em" }}>
                    {fmt(p.mvpValue)}
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2 }}>{deltaShort(p.delta)}</div>
                </div>

                <HoverButton
                  onClick={() => setExpanded(isOpen ? null : p.player)}
                  style={{
                    width: 30, height: 30, display: "grid", placeItems: "center",
                    background: "transparent", border: `1px solid ${C.lineStrong}`,
                    borderRadius: 8, color: C.textDim, cursor: "pointer",
                  }}
                  hoverStyle={{ borderColor: C.accentDeep, color: C.text }}
                >
                  {isOpen ? <ChevronUp /> : <ChevronDown />}
                </HoverButton>
              </div>

              {isOpen && (
                <div
                  style={{
                    borderTop: `1px solid ${C.line}`, background: C.surfaceSunk,
                    padding: "20px 18px 18px 108px",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "18px 12px" }}>
                    {statList(p).map((s) => (
                      <div key={s.label}>
                        <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost }}>
                          {s.label}
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 500, ...tabular, marginTop: 3 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <HoverButton
                      onClick={() => onOpenPlayer(p.player)}
                      style={{
                        height: 34, padding: "0 14px", background: "transparent",
                        border: `1px solid ${C.accentDeep}`, borderRadius: 8,
                        color: C.accentPale, fontSize: 13, cursor: "pointer",
                      }}
                      hoverStyle={{ background: C.accentWash, borderColor: C.accent }}
                    >
                      View profile →
                    </HoverButton>
                    <HoverButton
                      onClick={onTogglePanel}
                      style={{
                        height: 34, padding: "0 14px", background: "transparent",
                        border: `1px solid ${C.lineStrong}`, borderRadius: 8,
                        color: C.textDim, fontSize: 13, cursor: "pointer",
                      }}
                      hoverStyle={{ color: C.text, borderColor: C.accentDeep }}
                    >
                      How this score is built
                    </HoverButton>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Right rail ──────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 20 }}>
          <div style={{ ...label, marginBottom: 4 }}>Race to #1</div>
          <div style={{ fontSize: 12, color: C.textGhost, marginBottom: 14 }}>Rank by day, last 14</div>
          <svg width="100%" viewBox="0 0 300 176" style={{ display: "block", overflow: "visible" }}>
            {bump.grid.map((g) => (
              <line key={`l${g.id}`} x1={g.x1} y1={g.y} x2={g.x2} y2={g.y} stroke={C.raised} strokeWidth={1} />
            ))}
            {bump.grid.map((g) => (
              <text key={`t${g.id}`} x={0} y={g.ty} fill={C.textGhost} fontSize={9}>{g.label}</text>
            ))}
            {bump.gaps.map((s) => (
              <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={1.4} strokeDasharray="2 3" opacity={0.55} />
            ))}
            {bump.segments.map((s) => (
              <polyline key={s.id} points={s.points} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {bump.ends.map((e) => (
              <circle key={`c${e.id}`} cx={e.x} cy={e.y} r={3} fill={e.color} />
            ))}
            {bump.ends.map((e) => (
              <text key={`x${e.id}`} x={e.tx} y={e.ty} fill={e.color} fontSize={9} textAnchor="end">{e.label}</text>
            ))}
          </svg>
        </div>

        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 20 }}>
          <div style={{ ...label, marginBottom: 12 }}>The formula</div>
          <div style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.8, color: C.textMuted }}>
            <div>Total = <span style={{ color: C.accentBright }}>availability</span> ·</div>
            <div style={{ paddingLeft: 22 }}>( <span style={{ color: C.accentBright }}>0.5</span> · Win Contribution</div>
            <div style={{ paddingLeft: 46 }}>+ <span style={{ color: C.accentBright }}>0.5</span> · Total Stats )</div>
          </div>
          <p style={{ margin: "14px 0 16px", fontSize: 12, color: C.textFaint, textWrap: "pretty" }}>
            Half of the score is what a player does for winning basketball; half is raw
            production, efficiency-weighted. Both are then scaled by the share of his
            team's games he was available for — every other term is a per-game rate and
            cannot tell 25 appearances from 55.
          </p>
          <HoverButton
            onClick={onTogglePanel}
            style={{
              height: 32, padding: "0 12px", background: "transparent",
              border: `1px solid ${C.accentDeep}`, borderRadius: 8,
              color: C.accentPale, fontSize: 12, cursor: "pointer",
            }}
            hoverStyle={{ background: C.accentWash, borderColor: C.accent }}
          >
            Open the breakdown
          </HoverButton>
        </div>

        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 20 }}>
          <div style={{ ...label, marginBottom: 12 }}>Collector</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Source", value: "basketball-reference" },
              {
                label: "Last run",
                value: dateKey === D.TODAY_KEY ? "06:12 ET today" : snap?.missing ? "failed" : "06:12 ET",
              },
              { label: "Players tracked", value: String(D.PLAYERS.length) },
              { label: "Gaps in window", value: String(D.MISSING.size) },
            ].map((c) => (
              <div key={c.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12 }}>
                <span style={{ color: C.textFaint }}>{c.label}</span>
                <span style={{ color: C.text, ...tabular }}>{c.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
