// BrowserRouter, Routes, Route, and NavLink all come from react-router-dom.
// React Router watches the browser's URL and swaps which component is rendered
// based on which Route's path matches.
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import DailyMvpRankings from "./components/DailyMvpRankings";
import PlayerProfile from "./components/PlayerProfile";
import "./App.css";

function App() {
  return (
    // BrowserRouter must wrap everything that uses routing.
    // It provides the "routing context" — all child components can read the
    // current URL and navigate to new URLs through this context.
    <BrowserRouter>
      <div className="app-container">
        {/* ── Header ── always visible at the top, regardless of which page is shown */}
        <header className="app-header">
          <h1 className="app-title">NBA MVP Tracker</h1>

          {/* Tab navigation.
              NavLink is like a regular anchor tag, but it automatically adds a
              CSS class when its target URL matches the current URL — we use that
              to visually highlight whichever tab is active. */}
          <nav className="tab-nav">
            {/* "end" tells NavLink to only mark itself active when the URL is
                exactly "/", not also when it's "/player/..." */}
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `tab ${isActive ? "tab--active" : ""}`
              }
            >
              Daily Rankings
            </NavLink>

            <NavLink
              to="/player"
              className={({ isActive }) =>
                `tab ${isActive ? "tab--active" : ""}`
              }
            >
              Player Profile
            </NavLink>
          </nav>
        </header>

        {/* ── Page content ── only the matching <Route> renders here */}
        <main className="app-main">
          <Routes>
            {/* Homepage: shows today's MVP rankings with an optional date picker */}
            <Route path="/" element={<DailyMvpRankings />} />

            {/* Player profile page.
                :playerName is a URL parameter — whatever comes after /player/
                gets captured and passed into the PlayerProfile component.
                Example: /player/LeBron%20James → playerName = "LeBron James" */}
            <Route path="/player/:playerName" element={<PlayerProfile />} />

            {/* Fallback: /player with no player name selected yet */}
            <Route
              path="/player"
              element={
                <div className="placeholder-message">
                  <p>Select a player from the Daily Rankings to view their profile.</p>
                </div>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
