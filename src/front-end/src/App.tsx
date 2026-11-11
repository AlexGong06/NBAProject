// Shell for the MVP tracker.
//
// Routing is kept from the original app so a player profile has its own URL and
// can be linked to. Search and the formula drawer are local UI state shared
// across both views.
//
// The selected date is not state — it lives in the URL as `?date=`. Both views
// are a function of a date, and holding it in memory meant a profile could not
// be linked to as it was being read, and that moving between the board and a
// profile silently changed which day you were looking at.
//
// `?season=` works the same way and for the same reason, with one difference:
// a date is a selection within loaded data, while a season IS the data.
// Changing it reloads the whole source, because the calendar, the board, the
// ranks, the charts and the roster are every one of them scoped to a season.

import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter, Route, Routes, useNavigate, useParams, useSearchParams,
} from "react-router-dom";
import { DATA_MODE, loadDataSource } from "./data";
import type { DataSource } from "./data/types";
import { C, FONT } from "./theme";
import Nav from "./components/Nav";
import SearchOverlay from "./components/SearchOverlay";
import FormulaPanel from "./components/FormulaPanel";
import RankingsView from "./components/RankingsView";
import TabBar, { TAB_BAR_HEIGHT } from "./components/TabBar";
import { useIsMobile } from "./use-media-query";
import PlayerProfileView from "./components/PlayerProfileView";

const TOP_N = 5;

function Shell() {
  const navigate = useNavigate();
  const { playerName } = useParams();
  const decodedName = playerName ? decodeURIComponent(playerName) : null;

  const [searchParams, setSearchParams] = useSearchParams();

  const [D, setD] = useState<DataSource | null>(null);

  // Absent on first load, so the API picks — the newest season that actually
  // has data, which the bundle cannot know. After that the picker sets it.
  const seasonParam = searchParams.get("season");

  /**
   * The outcome of the most recent load, and which season it was for.
   *
   * Written only inside promise callbacks, never in an effect body. Both
   * "are we loading" and "did it fail" are then DERIVED by comparing `season`
   * against what the URL currently asks for, which has two consequences worth
   * the indirection:
   *
   * - A stale error cannot outlive the season it belongs to. Clearing it used
   *   to be a second `setState` at the top of the effect.
   * - The busy flag cannot desync from reality. A flag set true in one place
   *   and false in three others is a flag that eventually stays true.
   */
  const [settledSeason, setSettledSeason] =
    useState<{ season: string | null; error: string | null } | null>(null);

  // Loading until the settled record is for the season being asked for.
  // `null` on first render, which is not `seasonParam`, so the initial load
  // reports busy without anyone setting a flag.
  const seasonLoading = settledSeason?.season !== seasonParam;
  const loadError =
    settledSeason && settledSeason.season === seasonParam
      ? settledSeason.error
      : null;

  // Resolved before the hooks below, because they depend on it and a hook
  // cannot sit after the early return for the loading state.
  //
  // A `?date=` for a day outside the season — a stale link, a typo, a
  // hand-edited URL — falls back to the latest date rather than rendering an
  // empty board.
  const requestedDate = searchParams.get("date");
  const dateKey: string | null = D
    ? requestedDate && D.dateIndex(requestedDate) >= 0
      ? requestedDate
      : D.TODAY_KEY
    : null;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const isMobile = useIsMobile();

  // Reloads whenever the season changes. The previous season's source stays on
  // screen, dimmed, until the new one lands — swapping it for a spinner would
  // blank the whole page for a request that takes about as long as a date
  // change already does.
  useEffect(() => {
    let alive = true;
    loadDataSource(seasonParam ?? undefined)
      .then((src) => {
        if (!alive) return;
        setD(src);
        setSettledSeason({ season: seasonParam, error: null });
      })
      .catch((err: Error) => {
        if (!alive) return;
        // The previous season's source stays on screen behind the error, so a
        // failed switch is recoverable by picking another season.
        setSettledSeason({ season: seasonParam, error: err.message });
      });
    return () => { alive = false; };
  }, [seasonParam]);

  // ── Load the date being viewed ───────────────────────────────────────────
  //
  // The app holds one date's rows at a time rather than the season's — see the
  // note in data/api.ts. A date that has not been fetched has no board, so this
  // fetches it and re-renders when it lands.
  //
  // `dateLoading` exists so the views can dim rather than unmount. At ~170 ms a
  // spinner that replaced the board would flash and shift the layout, which
  // reads worse than the wait it is reporting.
  /**
   * The last date whose fetch finished, qualified by season.
   *
   * Qualified because the same "M-D-YYYY" key can exist in two seasons, and an
   * unqualified match after a season switch would be a no-op `setState` — no
   * re-render, and a board that never un-dims.
   *
   * This doubles as the re-render trigger. `ensureDate` fills a cache inside
   * the data source, which React cannot observe; settling here is what tells
   * it to look again.
   */
  const [settledDate, setSettledDate] = useState<string | null>(null);
  const dateToken = D && dateKey ? `${D.SEASON_ID}|${dateKey}` : null;

  // Derived, with `isDateLoaded` consulted first so an already-cached date —
  // the opening one, every time — never flashes dim.
  //
  // The `settledDate` half is what makes this safe: `ensureDate` populates its
  // cache only when rows come back, so a date that legitimately has none would
  // leave `isDateLoaded` false forever. Deriving from that alone would dim the
  // app permanently.
  const dateLoading =
    D != null &&
    dateKey != null &&
    !D.isDateLoaded(dateKey) &&
    settledDate !== dateToken;

  useEffect(() => {
    if (!D || !dateKey) return;
    // No NO_GAME_DAYS short-circuit here: an off day still needs the previous
    // game day's rows, which `ensureDate` resolves to. Skipping on "no games"
    // left the All-Star break with no board at all.
    if (D.isDateLoaded(dateKey)) return;

    let alive = true;
    // `finally`, not `then`: a date that resolves to no rows has still been
    // answered, and the board has to stop reporting itself as loading.
    D.ensureDate(dateKey).finally(() => {
      if (alive) setSettledDate(`${D.SEASON_ID}|${dateKey}`);
    });

    return () => { alive = false; };
  }, [D, dateKey]);

  // ⌘K opens search, Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  // The date rides along, so opening a player from the Nov 16 board lands on
  // Nov 16 rather than silently jumping to the end of the season.
  const openPlayer = useCallback(
    (name: string) => {
      setSearchOpen(false);
      const search = searchParams.toString();
      navigate(`/player/${encodeURIComponent(name)}${search ? `?${search}` : ""}`);
    },
    [navigate, searchParams],
  );

  // Straight to a game, with the date carried along. The panel and the game id
  // live in the URL for the same reason `?date=` does: a profile has to be
  // linkable in the state it is being read in, and a game view that could not
  // be linked to would be the only part of the app that could not.
  const openGame = useCallback(
    (name: string, gameId: string) => {
      setSearchOpen(false);
      const next = new URLSearchParams(searchParams);
      next.set("panel", "game");
      next.set("game", gameId);
      navigate(`/player/${encodeURIComponent(name)}?${next.toString()}`);
    },
    [navigate, searchParams],
  );

  const pickPanel = useCallback(
    (next: "trend" | "game") => {
      const params = new URLSearchParams(searchParams);
      if (next === "game") {
        params.set("panel", "game");
        // Clearing `?game=` makes the tab mean what its label says: his last
        // game as of this date. After stepping back through a few games the tab
        // still previews the anchor, so clicking it has to return there rather
        // than leaving you on whichever game you stopped at.
        params.delete("game");
      } else {
        // Leaving the game panel drops the game with it. A `?game=` left behind
        // on the trend view would silently pin the panel to one game the next
        // time it was opened, ignoring the date.
        params.delete("panel");
        params.delete("game");
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // `replace` so stepping through a player's games does not bury the board
  // under a hundred history entries — the same reasoning as the date ribbon.
  const pickGame = useCallback(
    (gameId: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("panel", "game");
      params.set("game", gameId);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // ── Changing season ──────────────────────────────────────────────────────
  //
  // Everything else in the URL belongs to the season being left. A date is the
  // clearest case — "4-12-2026" does not exist in 2026-27 — but a game id is
  // worse, because game ids are namespaced per season and a stale one would
  // simply 404 inside an open panel. All three go.
  //
  // Not `replace`: moving between seasons is a real navigation, and the back
  // button should return you to the one you came from.
  const pickSeason = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("season", id);
      next.delete("date");
      next.delete("game");
      next.delete("panel");
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  /**
   * The rankings URL for the current date AND season.
   *
   * Three places navigated to the board by hand-building "/?date=...", which
   * dropped every other parameter. That was harmless while `?date=` was the
   * only one; with `?season=` it silently threw you back to the default season
   * whenever you left a profile or tapped Rankings — the board would reload a
   * different season than the one you were reading.
   */
  const rankingsHref = useCallback(() => {
    const params = new URLSearchParams();
    if (dateKey) params.set("date", dateKey);
    const season = searchParams.get("season");
    if (season) params.set("season", season);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }, [dateKey, searchParams]);

  const pickDate = useCallback(
    (key: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("date", key);
      // `replace` so scrubbing the ribbon does not bury the previous page under
      // a hundred history entries.
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const page: React.CSSProperties = {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: FONT,
    fontSize: 15,
    lineHeight: 1.55,
    position: "relative",
    overflow: "hidden",
    // Clear the fixed tab bar, or it covers the last rows of every page.
    paddingBottom: isMobile
      ? `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px))`
      : undefined,
  };

  if (loadError) {
    return (
      <div style={{ ...page, display: "grid", placeItems: "center", padding: 40 }}>
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 500, margin: "0 0 12px" }}>
            Could not load rankings
          </h1>
          <p style={{ color: C.textDim, fontSize: 14, margin: "0 0 8px" }}>{loadError}</p>
          <p style={{ color: C.textFaint, fontSize: 13 }}>
            Running in <code>{DATA_MODE}</code> mode. Unset <code>VITE_DATA</code> to use the
            bundled fixture, which needs no database.
          </p>
        </div>
      </div>
    );
  }

  if (!D || !dateKey) {
    return (
      <div style={{ ...page, display: "grid", placeItems: "center" }}>
        <div style={{ color: C.textFaint, fontSize: 13 }}>Loading rankings…</div>
      </div>
    );
  }

  // Anything other than "game" is the trend, so a mangled `?panel=` degrades to
  // the default view rather than to a blank one.
  const panelParam = searchParams.get("panel") === "game" ? "game" : "trend";

  const view = decodedName ? "profile" : "rankings";
  const todayRows = D.rankings(D.TODAY_KEY) ?? [];
  const focusPlayer =
    (decodedName ? D.findPlayer(decodedName) : undefined) ??
    (todayRows.length ? D.findPlayer(todayRows[0].player) : undefined) ??
    D.PLAYERS[0];

  return (
    <div style={page}>
      <Nav
        view={view}
        season={D.SEASON}
        seasonId={D.SEASON_ID}
        seasons={D.AVAILABLE_SEASONS}
        onPickSeason={pickSeason}
        seasonBusy={seasonLoading}
        onGoRankings={() => navigate(rankingsHref())}
        onOpenSearch={() => {
          setQuery("");
          setSearchOpen(true);
        }}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />

      {/* Dimmed, not replaced. A date costs about 170 ms to fetch; swapping the
          board for a spinner would flash and shift the layout for longer than
          the wait it reports. */}
      <div
        style={{
          opacity: dateLoading || seasonLoading ? 0.55 : 1,
          transition: "opacity 180ms ease",
        }}
      >
      {view === "rankings" ? (
        <RankingsView
          D={D}
          dateKey={dateKey}
          topN={TOP_N}
          onPickDate={pickDate}
          onOpenPlayer={openPlayer}
          onOpenGame={openGame}
          onTogglePanel={() => setPanelOpen(true)}
        />
      ) : (
        <PlayerProfileView
          D={D}
          playerName={decodedName as string}
          dateKey={dateKey}
          onPickDate={pickDate}
          panel={panelParam}
          gameId={searchParams.get("game")}
          onPickPanel={pickPanel}
          onPickGame={pickGame}
          onBack={() => navigate(rankingsHref())}
          onOpenPlayer={openPlayer}
          onTogglePanel={() => setPanelOpen(true)}
        />
      )}

      </div>

      {searchOpen && (
        <SearchOverlay
          D={D}
          query={query}
          onQuery={setQuery}
          onClose={() => setSearchOpen(false)}
          onOpenPlayer={openPlayer}
        />
      )}

      {panelOpen && (
        <FormulaPanel player={focusPlayer} onClose={() => setPanelOpen(false)} />
      )}

      {isMobile && (
        <TabBar
          view={view}
          panelOpen={panelOpen}
          onGoRankings={() => navigate(rankingsHref())}
          onOpenSearch={() => {
            setQuery("");
            setSearchOpen(true);
          }}
          onTogglePanel={() => setPanelOpen((v) => !v)}
        />
      )}

    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Shell />} />
        <Route path="/player/:playerName" element={<Shell />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
  );
}
