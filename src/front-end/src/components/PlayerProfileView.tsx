import { useEffect, useState } from "react";
import { C, LEAGUE_NOTES, fmt, initials, label, statList, tabular } from "../theme";
import { mainChart } from "../charts";
import type { ChartMode } from "../charts";
import type { DataSource, FieldWindow, PlayerGame, PlayerSeason } from "../data/types";
import { headshotUrl } from "../data/headshot";
import { shortDate } from "../data/last-game";
import SeasonRibbon from "./SeasonRibbon";
import GameView from "./GameView";
import {
  ArrowLeft, ChartLineIcon, ChevronLeft, ChevronRight, ExternalIcon, Headshot,
  HoverButton, PlayIcon,
} from "./ui";

type Props = {
  D: DataSource;
  playerName: string;
  dateKey: string;
  onPickDate: (key: string) => void;
  /** Which panel is showing, from `?panel=`. */
  panel: "trend" | "game";
  /** From `?game=`; null resolves to his last game on or before `dateKey`. */
  gameId: string | null;
  onPickPanel: (panel: "trend" | "game") => void;
  onPickGame: (gameId: string) => void;
  onBack: () => void;
  onOpenPlayer: (name: string) => void;
  onTogglePanel: () => void;
  onToast: (msg: string) => void;
};

const MODES: { id: ChartMode; label: string }[] = [
  { id: "rank", label: "Rank" },
  { id: "score", label: "Value" },
];

const RANGES = [7, 14, 30];

/** Players either side of this one in the Field position rail. */
const FIELD_WINDOW = 10;

export default function PlayerProfileView({
  D, playerName, dateKey, onPickDate, panel, gameId, onPickPanel, onPickGame,
  onBack, onOpenPlayer, onTogglePanel, onToast,
}: Props) {
  const [mode, setMode] = useState<ChartMode>("rank");
  const [range, setRange] = useState(14);

  // The season is always fetched, even for a player already in the board.
  //
  // Board membership used to be treated as "we have his season", but the board
  // is a top N per date: a player who cracked it once, on a one-game sample in
  // November, was served that single row as his whole career here. His November
  // rank appeared as his current rank and his chart had one point in it.
  //
  // Nor is there a `?? D.PLAYERS[0]` fallback anywhere below. That silently
  // rendered the league leader's profile under an unknown player's URL — a page
  // that looks completely normal and is about the wrong person.
  const [season, setSeason] = useState<PlayerSeason | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let alive = true;
    setSeason(null);
    setLoadState("loading");
    D.loadPlayerSeason(playerName)
      .then((loaded) => {
        if (!alive) return;
        setSeason(loaded);
        setLoadState(loaded ? "ready" : "missing");
      })
      .catch(() => alive && setLoadState("missing"));
    return () => { alive = false; };
  }, [D, playerName]);

  // Where he sits on the selected date, and who is next to him. Refetched when
  // the date changes — that is the whole point of the date picker.
  const [field, setField] = useState<FieldWindow | null>(null);

  useEffect(() => {
    let alive = true;
    setField(null);
    D.fieldAround(playerName, dateKey, FIELD_WINDOW)
      .then((f) => alive && setField(f))
      .catch(() => alive && setField(null));
    return () => { alive = false; };
  }, [D, playerName, dateKey]);

  // ── The game panel ───────────────────────────────────────────────────────
  const [game, setGame] = useState<PlayerGame | null>(null);
  const [gameState, setGameState] = useState<"idle" | "loading" | "missing">("idle");
  const [videoPlaying, setVideoPlaying] = useState(false);

  useEffect(() => {
    if (panel !== "game") return;
    let alive = true;
    setGameState("loading");
    setGame(null);

    const load = gameId
      ? D.loadGame(playerName, gameId)
      : D.loadLastGame(playerName, dateKey);

    load
      .then((g) => {
        if (!alive) return;
        setGame(g);
        setGameState(g ? "idle" : "missing");
      })
      .catch(() => alive && setGameState("missing"));

    return () => { alive = false; };
  }, [D, panel, playerName, gameId, dateKey]);

  // Leaving an iframe mounted while the game changes plays the previous reel
  // under the new header — the most confidently wrong state this panel has.
  //
  // Keyed on the game actually being shown, not on the params that usually
  // imply one. With no `?game=` the panel resolves whatever game the *date*
  // lands on, so `gameId` stays null while the content changes underneath —
  // and a reel already playing would carry over and autoplay the next day's
  // game unasked.
  useEffect(() => {
    setVideoPlaying(false);
  }, [game?.gameId, panel, playerName]);

  // Every number on this page comes from the row for the selected date. Rank is
  // the exception — that comes from `field`, which knows how large a field it
  // measured against and whether that field was the whole league.
  const row = D.rowFor(playerName, dateKey);
  const p = row ?? season?.current ?? D.findPlayer(playerName) ?? null;

  if (!p) {
    return (
      <div style={{ padding: "28px 40px", display: "grid", placeItems: "center", minHeight: 320 }}>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <div style={{ color: C.textFaint, fontSize: 13, marginBottom: 14 }}>
            {loadState === "loading"
              ? `Loading ${playerName}…`
              : `No season data for ${playerName}.`}
          </div>
          {loadState === "missing" && (
            <div style={{ color: C.textFaint, fontSize: 12, marginBottom: 16 }}>
              The bundled fixture holds only the players who reached a top 25.
              Run the API with <code>VITE_DATA=api</code> to reach the whole league.
            </div>
          )}
          <HoverButton
            onClick={onBack}
            style={{
              height: 32, padding: "0 14px", background: "transparent",
              border: `1px solid ${C.lineStrong}`, borderRadius: 8,
              color: C.textDim, cursor: "pointer", fontSize: 13,
            }}
            hoverStyle={{ color: C.text, borderColor: C.accentDeep }}
          >
            Back to rankings
          </HoverButton>
        </div>
      </div>
    );
  }

  // The row already carries every term of the formula — read it, never recompute.
  //
  // Note this is `row`, not `row ?? p`. On a date the player has no row for,
  // `p` falls back to whatever row identifies him, and printing that row's
  // figures under this date's heading is the same category of error as the
  // stale rank: a page that says "no data" in one corner and quotes numbers in
  // the other. Every stat block below is gated on `row` instead.
  const b = row;
  const totalHalf = b ? b.winContribution + b.totalStats : 0;

  const dateIdx = D.dateIndex(dateKey);
  const date = D.DATES[dateIdx];
  const stepDate = (by: number) => {
    const next = D.DATES[dateIdx + by];
    if (next) onPickDate(next.key);
  };

  // Peak within the window on screen, not a fixed 30 days measured from the end
  // of the season. The chart and this figure now describe the same stretch of
  // time, so they cannot contradict each other.
  const windowRanks = D.history(p.player, dateKey, range)
    .filter((x) => x.rank != null)
    .map((x) => x.rank as number);
  const peak = windowRanks.length ? Math.min(...windowRanks) : null;

  const chart = mainChart(D, p.player, dateKey, range, mode);
  const games = D.nextGames(p.player);

  const wcPct = b ? ((b.winContribution / totalHalf) * 100).toFixed(1) : "0";
  const tsPct = b ? ((b.totalStats / totalHalf) * 100).toFixed(1) : "0";

  // A preview on the tab, from the board row we already hold — no extra fetch
  // just to label a tab. Falls back to nothing rather than to a guess.
  const lg = row?.lastGame ?? null;
  const lastGameNote = lg
    ? `${lg.win ? "W" : "L"} ${lg.teamScore}\u2013${lg.opponentScore} \u00b7 ${shortDate(lg.date)}`
    : "";

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
            position: "relative", width: 132, height: 132, borderRadius: 999,
            background: C.raised, border: `1px solid ${C.lineStrong}`, overflow: "hidden",
          }}
        >
          <Headshot
            src={headshotUrl(p)}
            initials={initials(p.player)}
            size={132}
            fontSize={34}
          />
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
              // Position and age belong to the player; everything after belongs
              // to the date, and is omitted when there is no row for it.
              b ? `${b.teamWins}–${b.teamLosses}` : null,
              b ? `${b.gamesPlayed}/${b.teamGamesPlayed} games` : null,
              b ? `${b.minutesPerGame.toFixed(1)} MPG` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>

        {/* Rank and value are as of the selected date, and say which date that
            is. The old label read "Rank today" over whatever row happened to be
            in memory — for a player the board saw once in November, that was a
            four-month-old rank out of a 50-man field, presented as current. */}
        <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>
              Rank on {date.short}
            </div>
            <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.05, ...tabular, color: C.accentPale }}>
              {row ? (field ? `#${field.rank}` : "…") : "—"}
            </div>
            <div style={{ fontSize: 11, color: C.textFaint }}>
              {!row
                ? "No game data by this date"
                : field
                  ? field.complete
                    ? `of ${field.fieldSize} players`
                    : `of ${field.fieldSize} loaded — run the API for the full league`
                  : ""}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textFaint }}>
              MVP value
            </div>
            <div style={{ fontSize: 46, fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.05, ...tabular }}>
              {row ? fmt(row.mvpValue) : "—"}
            </div>
            <div style={{ fontSize: 11, color: C.textFaint }}>
              {peak ? `Peak #${peak} in ${range} days` : ""}
            </div>
          </div>
        </div>
      </div>

      {/* ── Date picker ─────────────────────────────────────────────────
          The profile is a function of a date, so the date is a control, not a
          caption. Same ribbon as the rankings view — one way to move through
          the season, in both places. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 0 4px" }}>
        <div style={{ display: "flex", border: `1px solid ${C.lineStrong}`, borderRadius: 8, overflow: "hidden" }}>
          <HoverButton
            onClick={() => stepDate(-1)}
            title="Previous day"
            style={{
              height: 30, width: 32, display: "grid", placeItems: "center",
              background: "transparent", border: 0, borderRight: `1px solid ${C.line}`,
              color: dateIdx > 0 ? C.textDim : C.textGhost,
              cursor: dateIdx > 0 ? "pointer" : "default",
            }}
            hoverStyle={dateIdx > 0 ? { color: C.text } : {}}
          >
            <ChevronLeft />
          </HoverButton>
          <HoverButton
            onClick={() => stepDate(1)}
            title="Next day"
            style={{
              height: 30, width: 32, display: "grid", placeItems: "center",
              background: "transparent", border: 0,
              color: dateIdx < D.DATES.length - 1 ? C.textDim : C.textGhost,
              cursor: dateIdx < D.DATES.length - 1 ? "pointer" : "default",
            }}
            hoverStyle={dateIdx < D.DATES.length - 1 ? { color: C.text } : {}}
          >
            <ChevronRight />
          </HoverButton>
        </div>

        <div style={{ fontSize: 15 }}>
          {date.weekday}, {date.long}
        </div>
        {D.NO_GAME_DAYS.has(dateKey) && (
          <span style={{ fontSize: 11, color: C.textGhost }}>
            no NBA games — as of {D.effectiveDate(dateKey)?.short}
          </span>
        )}

        <HoverButton
          onClick={() => onPickDate(D.TODAY_KEY)}
          style={{
            marginLeft: "auto", height: 30, padding: "0 12px",
            background: "transparent", border: `1px solid ${C.lineStrong}`,
            borderRadius: 8, color: C.textDim, fontSize: 12, cursor: "pointer",
          }}
          hoverStyle={{ color: C.text, borderColor: C.accentDeep }}
        >
          End of season
        </HoverButton>
      </div>

      <SeasonRibbon D={D} dateKey={dateKey} onPick={onPickDate} />

      {/* ── Panels ───────────────────────────────────────────────────────
          Tabs rather than a separate route: both panels are readings of one
          player on one date, and the date control above already governs both.
          A second route would need its own copy of the date and could disagree
          with the header. The panel still lives in the URL, so a profile stays
          linkable in the state it is being read in.

          The trailing note on each tab is a preview — the tab earns its click
          before it is clicked. */}
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.line}`, marginBottom: 20 }}>
        {([
          ["trend", "Trend", <ChartLineIcon key="c" />, "rank & value"],
          [
            "game",
            "Last game",
            <PlayIcon key="p" />,
            lastGameNote,
          ],
        ] as const).map(([id, text, icon, note]) => {
          const active = panel === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPickPanel(id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 9,
                padding: "10px 16px", marginBottom: -1, background: "none",
                border: 0, borderBottom: `2px solid ${active ? C.accent : "transparent"}`,
                color: active ? C.text : C.textDim,
                fontSize: 14, fontWeight: 500, cursor: "pointer", font: "inherit",
              }}
            >
              {icon}
              {text}
              {note && (
                <span style={{ fontSize: 11, fontWeight: 400, color: C.textFaint }}>{note}</span>
              )}
            </button>
          );
        })}
      </div>

      {panel === "game" ? (
        gameState === "loading" ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: C.textFaint, fontSize: 13 }}>
            Loading the game…
          </div>
        ) : game ? (
          <GameView
            game={game}
            playerName={playerName}
            playing={videoPlaying}
            onPlay={() => setVideoPlaying(true)}
            onStop={() => setVideoPlaying(false)}
            onPrev={game.prevGameId ? () => onPickGame(game.prevGameId!) : null}
            onNext={game.nextGameId ? () => onPickGame(game.nextGameId!) : null}
          />
        ) : (
          <div style={{ padding: "60px 0", textAlign: "center" }}>
            <div style={{ color: C.textDim, fontSize: 15 }}>No game to show</div>
            <div style={{ color: C.textGhost, fontSize: 12, marginTop: 6 }}>
              {`${p.player} had not played by ${date.long}, or this source carries no game data.`}
            </div>
          </div>
        )
      ) : (

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
              {/* Days with no games used to be shaded here and labelled "no
                  scrape". They are carried forward now, so the line runs flat
                  through them and there is nothing to shade. */}
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
          {b && (
          <div style={{ marginTop: 28 }}>
            <div style={{ ...label, marginBottom: 14 }}>
              Season averages · {b.teamGamesPlayed} team games
            </div>
            <div
              style={{
                display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1,
                background: C.line, border: `1px solid ${C.line}`,
                borderRadius: 12, overflow: "hidden",
              }}
            >
              {statList(b).map((s) => (
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
          )}

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
          {b && (
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
          )}

          <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, background: C.surface, padding: 22 }}>
            {/* The players immediately around him on the selected date, not the
                league's leaders. This used to render the last date's top 50,
                which for anyone outside it highlighted nobody and answered a
                question the visitor had not asked. */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={label}>Field position</div>
              <div style={{ fontSize: 11, color: C.textGhost }}>{date.short}</div>
            </div>

            {!field && (
              <div style={{ fontSize: 12, color: C.textFaint, padding: "8px 0" }}>
                {row ? "Loading the field…" : `${p.player} has no row on this date.`}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {(field?.rows ?? []).map((r) => {
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
      )}
    </div>
  );
}
