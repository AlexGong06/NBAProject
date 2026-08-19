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

import { useCallback, useEffect, useRef, useState } from "react";
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
import PlayerProfileView from "./components/PlayerProfileView";

const TOP_N = 5;

function Shell() {
  const navigate = useNavigate();
  const { playerName } = useParams();
  const decodedName = playerName ? decodeURIComponent(playerName) : null;

  const [searchParams, setSearchParams] = useSearchParams();

  const [D, setD] = useState<DataSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

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

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const showToast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
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

  if (!D) {
    return (
      <div style={{ ...page, display: "grid", placeItems: "center" }}>
        <div style={{ color: C.textFaint, fontSize: 13 }}>Loading rankings…</div>
      </div>
    );
  }

  // A `?date=` for a day outside the season — a stale link, a typo, a hand-edited
  // URL — falls back to the latest date rather than rendering an empty board.
  const requested = searchParams.get("date");
  const dateKey =
    requested && D.dateIndex(requested) >= 0 ? requested : D.TODAY_KEY;

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

      {view === "rankings" ? (
        <RankingsView
          D={D}
          dateKey={dateKey}
          topN={TOP_N}
          onPickDate={pickDate}
          onOpenPlayer={openPlayer}
          onTogglePanel={() => setPanelOpen(true)}
        />
      ) : (
        <PlayerProfileView
          D={D}
          playerName={decodedName as string}
          dateKey={dateKey}
          onPickDate={pickDate}
          onBack={() => navigate(`/?date=${encodeURIComponent(dateKey)}`)}
          onOpenPlayer={openPlayer}
          onTogglePanel={() => setPanelOpen(true)}
          onToast={showToast}
        />
      )}

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

      {toast && (
        <div
          style={{
            position: "fixed",
            right: 28,
            bottom: 28,
            zIndex: 90,
            background: C.raised,
            border: `1px solid ${C.accentDeep}`,
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 13,
            color: C.accentPale,
            boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
          }}
        >
          {toast}
        </div>
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
