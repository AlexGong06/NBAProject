// One game: the scoreline, the highlight reel, the player's line, the quarter
// scores, and a box score with a tab per roster.
//
// ── Everything here is one set of numbers added up two ways ───────────────
//
// The header score is the sum of each side's box score below it, not a separate
// stored figure, so the two cannot drift apart. The quarter scores come from
// the NBA's own scoreboard and sum to the same total — `pnpm verify-games`
// asserts all three agree across every one of the 1,230 games.

import React from "react";
import { C, label, tabular } from "../theme";
import type { BoxScoreRow, PlayerGame } from "../data/types";
import { teamLogoUrl } from "../data/team-logo";
import { scoreline, shortDate, venueLabel } from "../data/last-game";
import { ChevronLeft, ChevronRight, HoverButton, PlayIcon, TeamLogo } from "./ui";

type Props = {
  game: PlayerGame;
  playerName: string;
  /** Null disables the control — there is no game on that side. */
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function plusMinusColour(n: number): string {
  if (n > 0) return C.accentBright;
  if (n < 0) return C.pmNegative;
  return C.textFaint;
}

/** Q1-Q4, then OT, OT2… for however many periods the game ran to. */
function periodLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    i < 4 ? `Q${i + 1}` : i === 4 ? "OT" : `OT${i - 3}`,
  );
}

export default function GameView({
  game, playerName, onPrev, onNext, playing, onPlay, onStop,
}: Props) {
  const periods = Math.max(game.quarters.team.length, game.quarters.opponent.length);
  const labels = periodLabels(periods);

  const stepBtn = (enabled: boolean): React.CSSProperties => ({
    width: 32, height: 32, display: "grid", placeItems: "center",
    background: "transparent", borderRadius: 8,
    border: `1px solid ${enabled ? C.lineStrong : "#2a2c36"}`,
    color: enabled ? C.textDim : "#4a4d5c",
    cursor: enabled ? "pointer" : "default",
  });

  const side = (abbr: string, teamId: number, home: boolean, dim: boolean) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <TeamLogo src={teamLogoUrl(teamId)} abbr={abbr} size={34} dim={dim} labelled={false} />
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.02em", color: dim ? C.textDim : C.text }}>
          {abbr}
        </div>
        <div style={{ fontSize: 10, color: C.textFaint }}>
          {game.neutralSite ? "Neutral" : home ? "Home" : "Away"}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div
        style={{
          border: `1px solid ${C.lineStrong}`, borderRadius: 14,
          background: "linear-gradient(160deg, #262838 0%, #1c1e2b 68%)",
          padding: "20px 24px", display: "flex", alignItems: "center", gap: 22,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 34, height: 34, borderRadius: 7, display: "grid", placeItems: "center",
            fontSize: 15, fontWeight: 600, flex: "none",
            background: game.win ? "rgba(145,132,217,0.18)" : C.raised,
            color: game.win ? C.accentPale : C.textFaint,
          }}
        >
          {game.win ? "W" : "L"}
        </div>

        {side(game.team, game.teamId, game.home, false)}

        <div
          style={{
            fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em",
            ...tabular, whiteSpace: "nowrap", flex: "none",
          }}
        >
          {scoreline(game)}
        </div>

        {side(game.opponent, game.opponentTeamId, !game.home, true)}

        <div style={{ width: 1, height: 38, background: C.lineStrong }} />

        <div>
          <div style={{ fontSize: 13, color: C.text }}>{shortDate(game.date)}</div>
          <div style={{ fontSize: 11, color: C.textFaint }}>
            {`Game ${game.number} of ${game.of} · ${venueLabel(game)} ${game.opponent}`}
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <HoverButton
            onClick={() => onPrev?.()}
            title={onPrev ? "Previous game" : "No earlier game"}
            style={stepBtn(!!onPrev)}
            hoverStyle={onPrev ? { color: C.text, borderColor: C.accentDeep } : {}}
          >
            <ChevronLeft />
          </HoverButton>
          <HoverButton
            onClick={() => onNext?.()}
            title={onNext ? "Next game" : "No later game on or before this date"}
            style={stepBtn(!!onNext)}
            hoverStyle={onNext ? { color: C.text, borderColor: C.accentDeep } : {}}
          >
            <ChevronRight />
          </HoverButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 20, marginTop: 20 }}>
        {/* ── Highlight reel ─────────────────────────────────────────── */}
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.gameSurface, overflow: "hidden" }}>
          <div style={{ position: "relative", aspectRatio: "16 / 9", background: C.gameSurface }}>
            {!game.highlight ? (
              // A real answer, not a loading state. The resolver writes null
              // when it finds nothing, and the box score below is unaffected.
              <div
                style={{
                  position: "absolute", inset: 0, background: C.gameSurfaceAlt,
                  display: "grid", placeItems: "center", textAlign: "center", padding: 24,
                }}
              >
                <div>
                  <div
                    style={{
                      width: 44, height: 44, margin: "0 auto 14px", borderRadius: 10,
                      border: `1px dashed ${C.lineStrong}`, display: "grid", placeItems: "center",
                      color: C.textGhost,
                    }}
                  >
                    <PlayIcon size={16} />
                  </div>
                  <div style={{ fontSize: 15, color: C.textDim }}>No highlight reel found</div>
                  <div style={{ fontSize: 12, color: C.textGhost, maxWidth: "42ch", marginTop: 6 }}>
                    Nothing in the mapping for this game id. The box score below is unaffected.
                  </div>
                </div>
              </div>
            ) : playing ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${game.highlight.videoId}?autoplay=1&rel=0`}
                title={game.highlight.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            ) : (
              // Never auto-mounted. A YouTube embed is around a megabyte, and
              // the board links straight into this view — most visits will not
              // press play.
              <HoverButton
                onClick={onPlay}
                style={{
                  position: "absolute", inset: 0, width: "100%", border: 0, cursor: "pointer",
                  background: "radial-gradient(120% 90% at 50% 30%, #262838 0%, #14161f 100%)",
                  display: "grid", placeItems: "center", padding: 0,
                }}
                hoverStyle={{ filter: "brightness(1.12)" }}
              >
                <span
                  style={{
                    width: 64, height: 64, borderRadius: 999, display: "grid", placeItems: "center",
                    background: "rgba(145,132,217,0.14)", border: `1px solid ${C.accent}`,
                    color: C.accentPale,
                  }}
                >
                  <PlayIcon size={24} />
                </span>
              </HoverButton>
            )}
          </div>

          {game.highlight && (
            <div
              style={{
                padding: "14px 18px", borderTop: `1px solid ${C.line}`,
                display: "flex", alignItems: "center", gap: 14,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {game.highlight.title}
                </div>
                <div style={{ fontSize: 11, color: C.textFaint }}>
                  {`${game.highlight.channel} · ${game.highlight.durationLabel}`}
                </div>
              </div>
              {playing && (
                <HoverButton
                  onClick={onStop}
                  style={{
                    marginLeft: "auto", height: 30, padding: "0 12px", flex: "none",
                    background: "transparent", border: `1px solid ${C.lineStrong}`,
                    borderRadius: 8, color: C.textDim, fontSize: 12, cursor: "pointer",
                  }}
                  hoverStyle={{ color: C.text, borderColor: C.accentDeep }}
                >
                  Close player
                </HoverButton>
              )}
            </div>
          )}
        </div>

        {/* ── Right rail: his line, then the quarters ────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 22 }}>
            <div style={{ ...label, marginBottom: 16 }}>{playerName} — this game</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[
                ["Points", game.line.points],
                ["Rebounds", game.line.rebounds],
                ["Assists", game.line.assists],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <div style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.025em", ...tabular, color: C.accentPale }}>
                    {v as number}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost }}>
                    {k as string}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ height: 1, background: C.line, margin: "18px 0" }} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px 10px" }}>
              {[
                ["FG", game.line.fieldGoals],
                ["3PT", game.line.threes],
                ["FT", game.line.freeThrows],
                ["STL", game.line.steals],
                ["BLK", game.line.blocks],
                ["TOV", game.line.turnovers],
                ["MIN", game.line.minutes.toFixed(1)],
                // Stored as a fraction, like every other rate in this project.
                ["TS%", `${(game.line.trueShooting * 100).toFixed(1)}`],
                ["+/−", signed(game.line.plusMinus)],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost }}>
                    {k as string}
                  </div>
                  <div
                    style={{
                      fontSize: 14, ...tabular, marginTop: 2,
                      color: k === "+/−" ? plusMinusColour(game.line.plusMinus) : C.text,
                    }}
                  >
                    {v as string}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 22 }}>
            <div style={{ ...label, marginBottom: 14 }}>Line score</div>
            <div style={{ display: "grid", gridTemplateColumns: `46px repeat(${periods + 1}, 1fr)`, rowGap: 8 }}>
              <div />
              {labels.map((l) => (
                <div key={l} style={{ fontSize: 10, textTransform: "uppercase", color: C.textGhost, textAlign: "right" }}>
                  {l}
                </div>
              ))}
              <div style={{ fontSize: 10, textTransform: "uppercase", color: C.textGhost, textAlign: "right" }}>F</div>

              {([
                [game.team, game.quarters.team, game.teamScore, C.text],
                [game.opponent, game.quarters.opponent, game.opponentScore, C.textDim],
              ] as const).map(([abbr, qs, total, colour]) => (
                <React.Fragment key={abbr}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", color: colour }}>{abbr}</div>
                  {labels.map((_, i) => (
                    <div key={i} style={{ fontSize: 13, ...tabular, color: colour, textAlign: "right" }}>
                      {qs[i] ?? "–"}
                    </div>
                  ))}
                  <div style={{ fontSize: 13, fontWeight: 500, ...tabular, color: colour, textAlign: "right" }}>
                    {total}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Box score ────────────────────────────────────────────────── */}
      <BoxScore
        rows={game.box}
        playerName={playerName}
        teamId={game.teamId}
        oppTeamId={game.opponentTeamId}
        teamAbbr={game.team}
        oppAbbr={game.opponent}
      />
    </div>
  );
}

const BOX_GRID = "minmax(0, 1fr) 64px 78px 64px 64px 64px 72px";

type BoxTotals = { minutes: number; points: number; rebounds: number; assists: number };

function totalsOf(rows: BoxScoreRow[]): BoxTotals {
  return rows.reduce<BoxTotals>(
    (t, r) => ({
      minutes: t.minutes + r.minutes,
      points: t.points + r.points,
      rebounds: t.rebounds + r.rebounds,
      assists: t.assists + r.assists,
    }),
    { minutes: 0, points: 0, rebounds: 0, assists: 0 },
  );
}

function BoxScore({
  rows, playerName, teamId, oppTeamId, teamAbbr, oppAbbr,
}: {
  rows: BoxScoreRow[];
  playerName: string;
  teamId: number;
  oppTeamId: number;
  teamAbbr: string;
  oppAbbr: string;
}) {
  // Held as a side rather than a team id: stepping to the next game keeps the
  // tab meaningful, where a stored id would point at a team no longer playing.
  const [side, setSide] = React.useState<"team" | "opponent">("team");

  const bySide = React.useMemo(() => {
    const split = (own: boolean) =>
      rows
        .filter((r) => (r.teamId === teamId) === own)
        // The tracked player stays pinned above his own team's minutes order —
        // this table exists to put his line in context, so losing him in
        // fifteen rows would defeat it. On the other side there is nothing to
        // pin and the sort is plain minutes.
        .sort(
          (a, b) =>
            Number(b.player === playerName) - Number(a.player === playerName) ||
            b.minutes - a.minutes,
        );
    return { team: split(true), opponent: split(false) };
  }, [rows, teamId, playerName]);

  const shown = bySide[side];
  const totals = totalsOf(shown);

  const cell: React.CSSProperties = { fontSize: 13, ...tabular, textAlign: "right" };
  const totalCell: React.CSSProperties = { ...cell, color: C.textDim };

  return (
    <div style={{ marginTop: 20, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ background: C.surfaceSunk, padding: "14px 18px", ...label }}>Box score</div>

      <div
        style={{
          display: "flex", gap: 2, padding: "0 18px",
          background: C.surfaceSunk, borderBottom: `1px solid ${C.line}`,
        }}
      >
        {([
          ["team", teamAbbr, teamId, bySide.team],
          ["opponent", oppAbbr, oppTeamId, bySide.opponent],
        ] as const).map(([id, abbr, logoTeamId, list]) => {
          const active = side === id;
          return (
            <HoverButton
              key={id}
              onClick={() => setSide(id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "9px 14px", marginBottom: -1, background: "none",
                border: 0, borderBottom: `2px solid ${active ? C.accent : "transparent"}`,
                color: active ? C.text : C.textDim,
                fontSize: 13, fontWeight: 500, cursor: "pointer",
              }}
              hoverStyle={active ? {} : { color: C.text }}
            >
              <TeamLogo
                src={teamLogoUrl(logoTeamId)}
                abbr={abbr}
                size={18}
                dim={!active}
                labelled={false}
              />
              {abbr}
              <span style={{ fontSize: 11, fontWeight: 400, ...tabular, color: C.textFaint }}>
                {`${totalsOf(list).points} pts`}
              </span>
            </HoverButton>
          );
        })}
      </div>

      <div
        style={{
          display: "grid", gridTemplateColumns: BOX_GRID, gap: 12,
          padding: "8px 18px", background: C.tableHead,
          fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textGhost,
        }}
      >
        <div>Player</div>
        {["MIN", "FG", "PTS", "REB", "AST", "+/−"].map((h) => (
          <div key={h} style={{ textAlign: "right" }}>{h}</div>
        ))}
      </div>

      {shown.map((r) => {
        const isSelf = r.player === playerName;
        return (
          <div
            key={r.playerId}
            style={{
              display: "grid", gridTemplateColumns: BOX_GRID, gap: 12,
              padding: "10px 18px", alignItems: "center",
              background: isSelf ? C.boxRowSelf : C.surface,
              borderTop: `1px solid ${C.line}`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13, color: isSelf ? C.accentPale : C.text,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {r.player}
              </div>
              {/* Inside a single team's tab the abbreviation that used to sit
                  here said the same thing as the tab above it. The rest of the
                  shooting line does not appear anywhere else in this table, and
                  FG alone hides a 5-of-15 night carried by twelve free throws. */}
              <div style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textGhost }}>
                {isSelf ? "MVP tracked" : `3PT ${r.threes} · FT ${r.freeThrows}`}
              </div>
            </div>
            <div style={cell}>{r.minutes.toFixed(1)}</div>
            <div style={cell}>{r.fieldGoals}</div>
            <div style={{ ...cell, color: isSelf ? C.accentPale : C.text }}>{r.points}</div>
            <div style={cell}>{r.rebounds}</div>
            <div style={cell}>{r.assists}</div>
            <div style={{ ...cell, color: plusMinusColour(r.plusMinus) }}>{signed(r.plusMinus)}</div>
          </div>
        );
      })}

      {/* PTS here is the same figure as this side of the header scoreline, added
          up the other way; a disagreement is a bug made visible. Plus-minus is
          left blank on purpose — summing it counts the margin once per player
          on the floor and means nothing. */}
      <div
        style={{
          display: "grid", gridTemplateColumns: BOX_GRID, gap: 12,
          padding: "10px 18px", alignItems: "center",
          background: C.surfaceSunk, borderTop: `1px solid ${C.lineStrong}`,
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: C.textFaint }}>
          {`${side === "team" ? teamAbbr : oppAbbr} total`}
        </div>
        <div style={totalCell}>{totals.minutes.toFixed(1)}</div>
        <div />
        <div style={{ ...totalCell, color: C.text }}>{totals.points}</div>
        <div style={totalCell}>{totals.rebounds}</div>
        <div style={totalCell}>{totals.assists}</div>
        <div />
      </div>
    </div>
  );
}
