import { useState } from "react";
import { C, MONO, deltaLabel, deltaShort, fmt, initials, label, statList, tabular } from "../theme";
import { bumpChart, sparkline } from "../charts";
import type { DataSource, RankedPlayer } from "../data/types";
import { headshotUrl } from "../data/headshot";
import SeasonRibbon from "./SeasonRibbon";
import MobileDatePicker from "./MobileDatePicker";
import LastGameChip from "./LastGameChip";
import { shortDate } from "../data/last-game";
import { useIsMobile } from "../use-media-query";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Headshot, HoverBox, HoverButton,
} from "./ui";

/**
 * A player's name as an SVG id fragment.
 *
 * Each face in the bump chart needs its own `<clipPath>`, and names carry
 * spaces, apostrophes and accents — "Nikola Jokić", "De'Anthony Melton" — none
 * of which survive in an id referenced by `url(#…)`.
 */
const slug = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "-");

type Props = {
  D: DataSource;
  dateKey: string;
  topN: number;
  onPickDate: (key: string) => void;
  onOpenPlayer: (name: string) => void;
  /** Opens a player's profile straight onto that game, rather than the trend. */
  onOpenGame: (name: string, gameId: string) => void;
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
  D, dateKey, topN, onPickDate, onOpenPlayer, onOpenGame, onTogglePanel,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const snap = D.snapshot(dateKey);

  // The standings in effect on this date, which on a day with no games are the
  // previous game day's. Every date in the season has a board now; the view no
  // longer has an "and otherwise show nothing" branch.
  const standings = D.standingsFor(dateKey);
  const rows = standings?.rows ?? null;
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
        // A player the bio endpoint did not cover carries a null `pos`; drop the segment rather
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
    // Game days only. Counting the carried-forward off days would inflate every
    // streak by however much of the All-Star break fell inside the window.
    const pts = D.history(hero.player, dateKey, 14).filter((p) => p.rank != null && !p.noGames);
    const held = pts.filter((p) => p.rank === 1).length;
    return `Held #1 for ${held} of the last ${pts.length} game days`;
  })();

  return (
    <div
      style={{
        display: "grid",
        // The sidebar drops below the board rather than beside it. 340px of
        // fixed rail plus a readable board needs ~700px that a phone has not got.
        gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 340px",
        gap: isMobile ? 28 : 48,
        padding: isMobile ? "20px 16px 56px" : "40px 40px 72px",
      }}
    >
      {/* ── Main column ─────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            // Side by side these two fight for width and the subtitle collapses
            // into a five-line ribbon. Stacked, the date gets the full width.
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "stretch" : "flex-end",
            justifyContent: "space-between",
            gap: isMobile ? 14 : 24,
            marginBottom: isMobile ? 20 : 28,
          }}
        >
          <div>
            <div style={{ ...label, marginBottom: 10 }}>Daily leaderboard</div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 26 : 42, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.05 }}>
              {snap ? snap.date.long : ""}
            </h1>
            <div style={{ marginTop: 8, fontSize: 13, color: C.textDim }}>
              {`Top ${topN} of ${D.ROSTER.length} players · ` +
                `total value = availability × (0.5 win contribution + 0.5 total stats)`}
            </div>
          </div>
          {/* The mobile picker carries its own stepper and reset, so this
              cluster would be a second copy of both directly above it. */}
          {!isMobile && (
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
                  height: 34, padding: "0 14px", background: "transparent", whiteSpace: "nowrap",
                  border: `1px solid ${C.lineStrong}`, borderRadius: 8,
                  color: C.textDim, fontSize: 13, cursor: "pointer",
                }}
                hoverStyle={{ borderColor: C.accentDeep, color: C.text }}
              >
                {/* Not "Today". This jumps to the last date in the season, which
                    is April 12 2026 and has not been today for months. The
                    profile view already called it this. */}
                End of season
              </HoverButton>
            </div>
          )}
        </div>

        {isMobile ? (
          <MobileDatePicker D={D} dateKey={dateKey} onPick={onPickDate} />
        ) : (
          <SeasonRibbon D={D} dateKey={dateKey} onPick={onPickDate} />
        )}

        {/* ── An off day ───────────────────────────────────────────────
            A note above a real board, not an error page instead of one.

            This used to be a warning icon reading "No scrape ran on …",
            "Historical days are never backfilled", and a `→ 404` receipt. Every
            word of that was left over from the nightly Basketball Reference
            scrape. Nothing failed on these ten days: the NBA did not play, so
            the standings are the ones from the last game day, unchanged. */}
        {standings?.noGames && (
          <div
            style={{
              display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px 14px",
              border: `1px solid ${C.lineStrong}`, borderRadius: 12,
              background: C.surfaceSunk, padding: "12px 16px", marginBottom: 20,
            }}
          >
            <span style={{ fontSize: 13, color: C.textMuted }}>
              <strong style={{ fontWeight: 500, color: C.text }}>No NBA games</strong>
              {" on "}{snap ? snap.date.long : dateKey} — standings unchanged since{" "}
              {standings.asOf.long}.
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
              <span style={{ fontSize: 11, color: C.textGhost }}>Nearest game days</span>
              {D.nearestGameDays(dateKey, 4).map((d) => (
                <HoverButton
                  key={d.key}
                  onClick={() => onPickDate(d.key)}
                  style={{
                    height: 26, padding: "0 10px", background: "transparent",
                    border: `1px solid ${C.accentDeep}`, borderRadius: 7,
                    color: C.accentPale, fontSize: 12, cursor: "pointer",
                  }}
                  hoverStyle={{ background: C.accentWash }}
                >
                  {d.short}
                </HoverButton>
              ))}
            </span>
          </div>
        )}

        {/* ── Hero: rank 1 ────────────────────────────────────────────── */}
        {hero && (() => {
          const d = decorate(hero, maxScore);
          const sp = sparkline(D, hero.player, dateKey, 140, 34);
          const heroOpen = expanded === hero.player;
          return (
            <div
              style={{
                border: `1px solid ${C.lineStrong}`, borderRadius: 14,
                overflow: "hidden",
                boxShadow: "0 16px 40px rgba(0,0,0,0.45)", marginBottom: 20,
              }}
            >
            <div
              style={{
                background: "linear-gradient(160deg, #262838 0%, #1c1e2b 62%)",
                padding: isMobile ? 18 : 28, display: "grid",
                gridTemplateColumns: isMobile ? "62px minmax(0, 1fr)" : "104px minmax(0, 1fr) 200px",
                gap: isMobile ? 14 : 28, alignItems: isMobile ? "start" : "center",
              }}
            >
              <HoverBox
                onClick={() => onOpenPlayer(hero.player)}
                style={{
                  position: "relative", width: isMobile ? 62 : 104, height: isMobile ? 62 : 104, borderRadius: 999,
                  background: C.line, border: `1px solid ${C.lineStrong}`,
                  display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden",
                }}
              >
                <Headshot
                  src={headshotUrl(hero)}
                  initials={initials(hero.player)}
                  size={isMobile ? 62 : 104}
                  fontSize={isMobile ? 18 : 26}
                />
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
                  style={{ fontSize: isMobile ? 21 : 34, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1, cursor: "pointer" }}
                  hoverStyle={{ color: C.accentPale }}
                >
                  {hero.player}
                </HoverBox>
                <div style={{ marginTop: 6, fontSize: 13, color: C.textDim }}>{d.meta}</div>
                <div style={{ marginTop: 18 }}>
                  <SplitBar wcPct={d.wcPct} tsPct={d.tsPct} height={10} fills={[C.line, C.accent, C.accentDeep]} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? "8px 14px" : 22, marginTop: 10, fontSize: 11, color: C.textDim }}>
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

                {/* The hero has no expandable drawer — it is a separate render
                    path from the rows below — so without this the league leader
                    would be the one player whose last game you could not see. */}
                {hero.lastGame && (
                  <div style={{ marginTop: 18 }}>
                    <LastGameChip
                      game={hero.lastGame}
                      viewedDateKey={dateKey}
                      onOpen={() => onOpenGame(hero.player, hero.lastGame!.gameId)}
                      wide
                    />
                  </div>
                )}
              </div>

              <div
                style={
                  isMobile
                    ? { textAlign: "left", gridColumn: "1 / -1", borderTop: `1px solid ${C.line}`, paddingTop: 14 }
                    : { textAlign: "right" }
                }
              >
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    justifyContent: isMobile ? "flex-start" : "flex-end",
                  }}
                >
                  <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>
                    MVP value
                  </div>
                  {/* Rank 1 opens the same drawer as every other row. Without
                      it, the one player the board exists to name was the only
                      one you could not expand. */}
                  <HoverButton
                    onClick={() => setExpanded(heroOpen ? null : hero.player)}
                    title={heroOpen ? "Collapse" : "Season averages"}
                    style={{
                      width: 30, height: 30, display: "grid", placeItems: "center",
                      background: "transparent", border: `1px solid ${C.lineStrong}`,
                      borderRadius: 8, color: C.textDim, cursor: "pointer",
                      marginLeft: isMobile ? "auto" : 0,
                    }}
                    hoverStyle={{ borderColor: C.accentDeep, color: C.text }}
                  >
                    {heroOpen ? <ChevronUp /> : <ChevronDown />}
                  </HoverButton>
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

            {heroOpen && (
              <RowDrawer
                p={hero}
                isMobile={isMobile}
                indent={false}
                onOpenPlayer={onOpenPlayer}
                onTogglePanel={onTogglePanel}
              />
            )}
            </div>
          );
        })()}

        {/* ── Rows 2..N ───────────────────────────────────────────────── */}
        {rest.map((p) => {
          const d = decorate(p, maxScore);
          const sp = sparkline(D, p.player, dateKey, 116, 30);
          const isOpen = expanded === p.player;
          return (
            <div
              key={p.player}
              style={{
                border: `1px solid ${C.line}`, borderRadius: 12,
                background: C.surface, marginBottom: 10, overflow: "hidden",
              }}
            >
              {/* The split bar's own column gave way to the last-game chip.
                  Its information survives as the label under the sparkline —
                  the percentages were what people read, not the bar. */}
              <div
                style={{
                  display: "grid",
                  // Seven columns need ~570px. On a phone the sparkline is
                  // dropped and the last-game chip moves to its own row below
                  // (see `order` on its container), leaving five.
                  gridTemplateColumns: isMobile
                    ? "24px 40px minmax(0, 1fr) 62px 30px"
                    : "34px 56px minmax(0, 1fr) 124px 224px 96px 34px",
                  alignItems: "center",
                  gap: isMobile ? 10 : 16,
                  padding: isMobile ? "12px 12px" : "14px 18px",
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
                    position: "relative", width: isMobile ? 40 : 52, height: isMobile ? 40 : 52, borderRadius: 999,
                    background: C.raised, border: `1px solid ${C.lineStrong}`,
                    display: "grid", placeItems: "center", cursor: "pointer", overflow: "hidden",
                  }}
                >
                  <Headshot
                    src={headshotUrl(p)}
                    initials={initials(p.player)}
                    size={isMobile ? 40 : 52}
                    fontSize={isMobile ? 12 : 14}
                  />
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
                      fontSize: isMobile ? 15 : 17, fontWeight: 500, letterSpacing: "-0.01em", cursor: "pointer",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                    hoverStyle={{ color: C.accentPale }}
                  >
                    {p.player}
                  </HoverBox>
                  <div style={{ fontSize: 12, color: C.textFaint, marginTop: 2 }}>{d.meta}</div>
                </div>

                {!isMobile && (
                  <div>
                    <svg width="100%" height={30} viewBox="0 0 116 30" style={{ display: "block", overflow: "visible" }}>
                      <polyline points={sp.points} fill="none" stroke={C.textFaint} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
                      <circle cx={sp.x} cy={sp.y} r={2.5} fill={C.accentBright} />
                    </svg>
                    <div style={{ fontSize: 10, color: C.textGhost, marginTop: 5 }}>{d.splitLabel}</div>
                  </div>
                )}

                {/* `order` moves this past the value and chevron, so grid
                    auto-placement drops it onto a second row of its own. */}
                <div style={isMobile ? { minWidth: 0, order: 1, gridColumn: "1 / -1" } : { minWidth: 0 }}>
                  {p.lastGame ? (
                    <LastGameChip
                      game={p.lastGame}
                      viewedDateKey={dateKey}
                      onOpen={() => onOpenGame(p.player, p.lastGame!.gameId)}
                    />
                  ) : (
                    // The fixture carries no game data, and a player can have no
                    // game before his debut. Say which rather than drawing an
                    // empty chip that looks like a failed fetch.
                    <div style={{ fontSize: 10, color: C.textGhost }}>No game yet</div>
                  )}
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 500, ...tabular, letterSpacing: "-0.02em" }}>
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
                <RowDrawer
                  p={p}
                  isMobile={isMobile}
                  indent={!isMobile}
                  onOpenPlayer={onOpenPlayer}
                  onTogglePanel={onTogglePanel}
                />
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
            {/* A face per line, in place of the team abbreviation that used to
                sit here. Initials are drawn underneath the image so a player
                the CDN has no photo of still resolves to something readable —
                the same ordering <Headshot> uses in the DOM. */}
            <defs>
              {bump.ends.map((e) => (
                <clipPath key={`p${e.id}`} id={`face-${slug(e.id)}`}>
                  <circle cx={e.cx} cy={e.cy} r={bump.faceRadius} />
                </clipPath>
              ))}
            </defs>
            {bump.ends.map((e) => (
              <g key={`f${e.id}`}>
                <title>{e.player}</title>
                <line
                  x1={e.x} y1={e.y} x2={e.cx - bump.faceRadius} y2={e.cy}
                  stroke={e.color} strokeWidth={1} opacity={0.45}
                />
                <circle cx={e.cx} cy={e.cy} r={bump.faceRadius} fill={C.raised} />
                <text
                  x={e.cx} y={e.cy + 3} fill={C.textFaint} fontSize={8}
                  textAnchor="middle"
                >
                  {e.initials}
                </text>
                {e.headshot && (
                  <image
                    href={e.headshot}
                    x={e.cx - bump.faceRadius} y={e.cy - bump.faceRadius}
                    width={bump.faceRadius * 2} height={bump.faceRadius * 2}
                    // These are 260x190 with the head high in the frame, so
                    // cover-and-align-top is what lands the face in the circle.
                    preserveAspectRatio="xMidYMin slice"
                    clipPath={`url(#face-${slug(e.id)})`}
                  />
                )}
                <circle
                  cx={e.cx} cy={e.cy} r={bump.faceRadius}
                  fill="none" stroke={e.color} strokeWidth={1.6}
                />
              </g>
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

        {/* A "Collector" card used to sit here reporting a source of
            basketball-reference, a hardcoded 06:12 ET run time, and a count of
            "gaps in window". None of it was true after the move to the NBA API:
            there is no collector, nothing runs on a schedule, and the gaps are
            days the NBA did not play. Deleted rather than rewritten — the rail
            does not need something in the slot. */}
      </div>
    </div>
  );
}

/**
 * The panel behind a row's chevron — the same one for rank 1 and for the rest.
 *
 * Shared rather than duplicated: the hero renders through a different path
 * above, and two copies of this would drift the moment either changed.
 */
function RowDrawer({
  p, isMobile, indent, onOpenPlayer, onTogglePanel,
}: {
  p: RankedPlayer;
  isMobile: boolean;
  indent: boolean;
  onOpenPlayer: (name: string) => void;
  onTogglePanel: () => void;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${C.line}`, background: C.surfaceSunk,
        padding: isMobile ? "16px 12px" : indent ? "20px 18px 18px 108px" : "20px 28px 18px",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 3 : 6}, 1fr)`, gap: "18px 12px" }}>
        {statList(p).map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost }}>
              {s.label}
            </div>
            <div style={{ fontSize: 17, fontWeight: 500, ...tabular, marginTop: 3 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10, marginTop: 20,
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}
      >
        {/* The chip above already shows this game and opens it, so there is no
            button here — but the line has to carry its own date. Unlabelled,
            these numbers read as season averages, which is wrong by a margin
            nobody would catch. */}
        {p.lastGame && (
          <>
            <span style={{ fontSize: 12, color: C.textFaint }}>
              {`${shortDate(p.lastGame.date)}: ${p.lastGame.points} pts · ` +
                `${p.lastGame.rebounds} reb · ${p.lastGame.assists} ast`}
            </span>
            <span style={{ flex: 1 }} />
          </>
        )}
        <HoverButton
          onClick={() => onOpenPlayer(p.player)}
          style={{
            height: 34, padding: "0 14px", background: "transparent", whiteSpace: "nowrap",
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
            height: 34, padding: "0 14px", background: "transparent", whiteSpace: "nowrap",
            border: `1px solid ${C.lineStrong}`, borderRadius: 8,
            color: C.textDim, fontSize: 13, cursor: "pointer",
          }}
          hoverStyle={{ color: C.text, borderColor: C.accentDeep }}
        >
          How this score is built
        </HoverButton>
      </div>
    </div>
  );
}
