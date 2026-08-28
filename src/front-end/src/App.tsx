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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let alive = true;
    loadDataSource()
      .then((src) => {
        if (alive) setD(src);
      })
      .catch((err: Error) => {
        if (alive) setLoadError(err.message);
      });
    return () => { alive = false; };
  }, []);

  // ── Load the date being viewed ───────────────────────────────────────────
  //
  // The app holds one date's rows at a time rather than the season's — see the
  // note in data/api.ts. A date that has not been fetched has no board, so this
  // fetches it and re-renders when it lands.
  //
  // `dateLoading` exists so the views can dim rather than unmount. At ~170 ms a
  // spinner that replaced the board would flash and shift the layout, which
  // reads worse than the wait it is reporting.
  const [dateLoading, setDateLoading] = useState(false);
  const [, setDateLoaded] = useState(0);

  useEffect(() => {
    if (!D || !dateKey) return;
    // No NO_GAME_DAYS short-circuit here: an off day still needs the previous
    // game day's rows, which `ensureDate` resolves to. Skipping on "no games"
    // left the All-Star break with no board at all.
    if (D.isDateLoaded(dateKey)) return;

    let alive = true;
    setDateLoading(true);
    D.ensureDate(dateKey)
      .then(() => {
        if (!alive) return;
        setDateLoaded((n) => n + 1);
      })
      .finally(() => alive && setDateLoading(false));

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
        onGoRankings={() => navigate("/")}
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
          opacity: dateLoading ? 0.55 : 1,
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
          onBack={() => navigate(`/?date=${encodeURIComponent(dateKey)}`)}
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
          onGoRankings={() => navigate(`/?date=${encodeURIComponent(dateKey)}`)}
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
