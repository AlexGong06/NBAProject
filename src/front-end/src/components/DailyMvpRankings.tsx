import { useEffect, useState } from "react";
import type { PlayerSummaryFromDatabase } from "../../../utils/types";
import PlayerRankingRow from "./PlayerRankingsRow";

const API_BASE_URL = "http://localhost:3000";

// ── Date format helpers ───────────────────────────────────────────────────
// The HTML <input type="date"> gives us dates as "YYYY-MM-DD".
// Our API stores and expects dates as "M-D-YYYY" (no leading zeros).
// These helpers convert between the two formats.

function htmlDateToApiDate(htmlDate: string): string {
  // "2026-02-17" → "2-17-2026"
  const [year, month, day] = htmlDate.split("-");
  // parseInt strips the leading zero: "02" → 2, "09" → 9
  return `${parseInt(month)}-${parseInt(day)}-${year}`;
}

function apiDateToHtmlDate(apiDate: string): string {
  // "2-17-2026" → "2026-02-17"  (needed to pre-fill the date input)
  const [month, day, year] = apiDate.split("-");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Returns today's date as "YYYY-MM-DD" — used to cap the picker so users
// can't try to fetch future dates (which will always return no data).
function todayHtmlDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0"); // getMonth() is 0-indexed
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function DailyMvpRankings() {
  // rankings holds the sorted list of players to display
  const [rankings, setRankings] = useState<PlayerSummaryFromDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // selectedDate is stored in HTML format ("YYYY-MM-DD") because that is what
  // the <input type="date"> element reads and writes.
  // null means "I haven't chosen a date yet — show the most recent available".
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // displayDate is shown in the heading (in the API's "M-D-YYYY" format).
  const [displayDate, setDisplayDate] = useState<string>("");

  // This effect runs whenever selectedDate changes.
  // It decides which API endpoint to call and updates the rankings state.
  useEffect(() => {
    const fetchRankings = async () => {
      setLoading(true);
      setError(null);

      try {
        if (selectedDate) {
          // ── A specific date was chosen ────────────────────────────────────
          const apiDate = htmlDateToApiDate(selectedDate);
          const res = await fetch(`${API_BASE_URL}/daily-mvp-rankings/${apiDate}`);

          // The backend returns HTTP 404 when no scraper ran that day.
          // We parse its JSON message and show it as a friendly notice.
          if (res.status === 404) {
            const body = await res.json();
            setError(body.message ?? `No data available for ${apiDate}.`);
            setRankings([]);
            setLoading(false);
            return;
          }

          if (!res.ok) throw new Error("Failed to fetch MVP rankings");

          const data: PlayerSummaryFromDatabase[] = await res.json();
          setDisplayDate(apiDate);
          // Sort rank 1 first (ascending by calculatedRank)
          setRankings([...data].sort((a, b) => a.calculatedRank - b.calculatedRank));
        } else {
          // ── No date chosen — fetch all, then keep only the most recent ────
          // The backend sorts records by date descending, so index 0 is newest.
          const res = await fetch(`${API_BASE_URL}/daily-mvp-rankings`);
          if (!res.ok) throw new Error("Failed to fetch MVP rankings");

          const allData: PlayerSummaryFromDatabase[] = await res.json();
          const latestDate = allData[0]?.date ?? "";

          // Pre-fill the date picker so the user can see what date they're on
          // and navigate from there.
          setSelectedDate(apiDateToHtmlDate(latestDate));
          setDisplayDate(latestDate);

          const filtered = allData
            .filter((r) => r.date === latestDate)
            .sort((a, b) => a.calculatedRank - b.calculatedRank);
          setRankings(filtered);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError("Unable to load MVP rankings: " + msg);
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, [selectedDate]); // ← the effect re-runs every time selectedDate changes

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      {/* ── Header row: title + date picker ──────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <h2 style={{ margin: 0 }}>
          MVP Rankings {displayDate ? `— ${displayDate}` : ""}
        </h2>

        {/* Date picker — lets the user browse historical rankings.
            "max" prevents choosing a future date. */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label
            htmlFor="date-picker"
            style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.6)" }}
          >
            View date:
          </label>
          <input
            id="date-picker"
            type="date"
            max={todayHtmlDate()}
            value={selectedDate ?? ""}
            onChange={(e) => {
              // e.target.value is "" when the user clears the field.
              // Setting null triggers the "fetch most recent" branch above.
              setSelectedDate(e.target.value || null);
            }}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #444",
              background: "#2a2a3e",
              color: "#fff",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          />
        </div>
      </div>

      {/* ── State feedback ────────────────────────────────────────────── */}
      {loading && <p>Loading MVP rankings...</p>}

      {/* Show the backend's "no data" message in a styled notice box */}
      {error && (
        <p
          style={{
            color: "#ff6b6b",
            background: "rgba(255,0,0,0.08)",
            padding: "12px 16px",
            borderRadius: "8px",
            border: "1px solid rgba(255,0,0,0.2)",
          }}
        >
          {error}
        </p>
      )}

      {/* ── Rankings list ─────────────────────────────────────────────── */}
      {!loading && !error && rankings.length > 0 && (
        <ol style={{ padding: 0 }}>
          {rankings.map((player) => (
            <PlayerRankingRow
              key={`${player.player}-${player.date}`}
              player={player}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
