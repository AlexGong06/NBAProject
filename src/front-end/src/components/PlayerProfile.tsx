import { useEffect, useState } from "react";
// useParams reads URL parameters (e.g. :playerName from /player/:playerName).
// useNavigate lets us change the URL programmatically (used for the back button).
import { useParams, useNavigate } from "react-router-dom";
import type { PlayerSummaryFromDatabase } from "../../../utils/types";
// Recharts components for the ranking history line chart.
// ResponsiveContainer — makes the chart resize with its parent div.
// LineChart — the chart container.
// Line — the actual plotted line.
// XAxis / YAxis — the horizontal and vertical axes.
// CartesianGrid — the subtle background grid lines.
// Tooltip — the pop-up that shows values when you hover a data point.
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import styles from "./PlayerProfile.module.css";

const API_BASE_URL = "http://localhost:3000";

// ── Date utilities ────────────────────────────────────────────────────────
// The API stores dates as "M-D-YYYY" (e.g. "2-17-2026").
// JavaScript's Date constructor expects month as 0-indexed (January = 0),
// so we subtract 1 from the month when building the Date object.

function parseApiDate(dateStr: string): Date {
  const [month, day, year] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Format a date string like "2-17-2026" into a short label like "Feb 17"
// for display on the chart's X-axis.
function formatChartLabel(dateStr: string): string {
  return parseApiDate(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ── Chart data type ───────────────────────────────────────────────────────
// This is the shape recharts expects for each data point in the line chart.
type ChartPoint = {
  date: string;  // formatted label shown on the X axis (e.g. "Feb 17")
  rank: number;  // the player's MVP rank on that day
};

export default function PlayerProfile() {
  // useParams returns an object containing all named URL parameters.
  // Here, :playerName from the route /player/:playerName is extracted.
  const { playerName } = useParams<{ playerName: string }>();
  const navigate = useNavigate();

  // history holds all the player's daily records fetched from the API,
  // ordered from most recent to oldest (the API sorts date descending).
  const [history, setHistory] = useState<PlayerSummaryFromDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // timeRange controls how many past days to include in the ranking chart.
  // The user can toggle between 7, 14, and 30 days. Max is 30 (≈ 1 month).
  const [timeRange, setTimeRange] = useState<7 | 14 | 30>(30);

  // The URL encodes special characters (e.g. spaces as %20).
  // decodeURIComponent reverses that: "LeBron%20James" → "LeBron James".
  const decodedName = playerName ? decodeURIComponent(playerName) : "";

  // Fetch the player's full ranking history whenever the player name changes.
  useEffect(() => {
    if (!decodedName) return;

    const fetchHistory = async () => {
      setLoading(true);
      setError(null);

      try {
        // encodeURIComponent re-encodes the name for the fetch URL,
        // ensuring the request reaches the server correctly.
        const res = await fetch(
          `${API_BASE_URL}/players/${encodeURIComponent(decodedName)}/daily-mvp-rankings`
        );
        if (!res.ok) throw new Error("Failed to fetch player history");

        const data: PlayerSummaryFromDatabase[] = await res.json();
        setHistory(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError("Unable to load player data: " + msg);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [decodedName]); // runs again if the user navigates to a different player

  // ── Loading / error / empty states ─────────────────────────────────────
  if (loading) return <p className={styles.message}>Loading player profile...</p>;
  if (error) return <p className={styles.messageError}>{error}</p>;

  if (history.length === 0) {
    return (
      <div className={styles.message}>
        <p>No data found for &ldquo;{decodedName}&rdquo;.</p>
        <button className={styles.backButton} onClick={() => navigate("/")}>
          ← Back to Rankings
        </button>
      </div>
    );
  }

  // ── Derived data ────────────────────────────────────────────────────────
  // history[0] is the most recent entry (API sorts date descending),
  // so it represents the player's current stats and rank.
  const current = history[0];

  // Build the headshot URL using the same pattern as PlayerRankingsRow.
  const playerId =
    current.profileUrl.split("/").pop()?.replace(".html", "") || "";
  const imageUrl = `https://www.basketball-reference.com/req/202106291/images/headshots/${playerId}.jpg`;

  // ── Build chart data ────────────────────────────────────────────────────
  // 1. Sort history oldest → newest so the line goes left-to-right in time.
  // 2. Filter to only include entries within the selected time range.
  // 3. Map each entry to the { date, rank } shape recharts expects.

  const sortedHistory = [...history].sort(
    (a, b) => parseApiDate(a.date).getTime() - parseApiDate(b.date).getTime()
  );

  // Calculate the cutoff: today minus timeRange days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - timeRange);

  const chartData: ChartPoint[] = sortedHistory
    .filter((entry) => parseApiDate(entry.date) >= cutoff)
    .map((entry) => ({
      date: formatChartLabel(entry.date),
      rank: entry.calculatedRank,
    }));

  // ── Formatting helpers ──────────────────────────────────────────────────
  const fmtNum = (val: number) => val.toFixed(1);
  // trueShootingPercentage is stored as a decimal (0.65 = 65%)
  const fmtPct = (val: number) => `${(val * 100).toFixed(1)}%`;
  // usageRate is stored as a raw percentage value (e.g. 30.5 means 30.5%)
  const fmtUsage = (val: number) => `${val.toFixed(1)}%`;

  return (
    <div className={styles.container}>
      {/* ── Back button ──────────────────────────────────────────────── */}
      <button className={styles.backButton} onClick={() => navigate("/")}>
        ← Back to Rankings
      </button>

      {/* ── Hero section: image + name + team + current rank ─────────── */}
      <div className={styles.heroSection}>
        <img
          src={imageUrl}
          alt={current.player}
          className={styles.heroImage}
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              "https://placehold.co/120x120?text=N/A";
          }}
        />

        <div className={styles.heroInfo}>
          <h2 className={styles.playerName}>{current.player}</h2>
          <p className={styles.teamInfo}>
            {current.team} &nbsp;·&nbsp; {current.teamWins}W /{" "}
            {current.teamGamesPlayed} GP
          </p>

          {/* Rank badge — visually highlights the current MVP ranking */}
          <div className={styles.rankBadge}>
            <span className={styles.rankLabel}>Current MVP Rank</span>
            <span className={styles.rankValue}>#{current.calculatedRank}</span>
          </div>
        </div>
      </div>

      {/* ── Season stats grid ─────────────────────────────────────────── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Season Stats</h3>
        <div className={styles.statsGrid}>
          {/* Each statItem shows a label and value in a small card */}
          <div className={styles.statItem}>
            <strong>PPG</strong>
            <span>{fmtNum(current.pointsPerGame)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>RPG</strong>
            <span>{fmtNum(current.reboundsPerGame)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>APG</strong>
            <span>{fmtNum(current.assistsPerGame)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>SPG</strong>
            <span>{fmtNum(current.stealsPerGame)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>BPG</strong>
            <span>{fmtNum(current.blocksPerGame)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>TOV</strong>
            <span>{fmtNum(current.turnoversPerGame)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>TS%</strong>
            <span>{fmtPct(current.trueShootingPercentage)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>USG%</strong>
            <span>{fmtUsage(current.usageRate)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>Win Share</strong>
            <span>{fmtNum(current.winShare)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>BPM</strong>
            <span>{fmtNum(current.boxPlusMinus)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>VORP</strong>
            <span>{fmtNum(current.valueOverReplacement)}</span>
          </div>
          <div className={styles.statItem}>
            <strong>MVP Score</strong>
            <span>{fmtNum(current.mvpValue)}</span>
          </div>
        </div>
      </section>

      {/* ── Ranking history chart ──────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Ranking History</h3>

          {/* Time range toggle buttons — let the user zoom in/out */}
          <div className={styles.rangeSelector}>
            {([7, 14, 30] as const).map((days) => (
              <button
                key={days}
                className={`${styles.rangeBtn} ${
                  timeRange === days ? styles.rangeBtnActive : ""
                }`}
                onClick={() => setTimeRange(days)}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {/* We need at least 2 points to draw a line; show a message otherwise */}
        {chartData.length < 2 ? (
          <p className={styles.noChartData}>
            Not enough data for the selected time range.
          </p>
        ) : (
          // ResponsiveContainer measures its parent div's width and passes it
          // to LineChart so the chart is always as wide as its container.
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
            >
              {/* Subtle dotted grid to make values easier to read */}
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />

              {/* X axis shows the date labels (e.g. "Feb 17") */}
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#666" }}
                tickLine={false}
              />

              {/* Y axis shows the rank number.
                  reversed={true} means rank 1 is at the TOP of the axis —
                  which is visually intuitive (higher = better). */}
              <YAxis
                reversed
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#666" }}
                tickLine={false}
                width={40}
                label={{
                  value: "Rank",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                  style: { fontSize: 11, fill: "#666" },
                }}
              />

              {/* Tooltip shows the exact rank when hovering a data point */}
              {/* Recharts passes value as number | undefined, so we guard with ?? */}
              <Tooltip
                formatter={(value: number | undefined) => [
                  value != null ? `#${value}` : "—",
                  "MVP Rank",
                ]}
                labelStyle={{ color: "#333", fontWeight: "bold" }}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  fontSize: "0.85rem",
                }}
              />

              {/* The line itself.
                  type="monotone" draws smooth curves instead of sharp angles.
                  dataKey="rank" tells recharts which field from chartData to plot. */}
              <Line
                type="monotone"
                dataKey="rank"
                stroke="#0070f3"
                strokeWidth={2}
                dot={{ r: 4, fill: "#0070f3", strokeWidth: 0 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── Upcoming games placeholder ─────────────────────────────────── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Upcoming Games</h3>
        <div className={styles.placeholder}>
          <p>Coming soon: Next 10 opponents for {current.player}</p>
          <p className={styles.placeholderSub}>
            This will show the next 10 teams {current.player} is scheduled to
            play against so you can plan which games to watch.
          </p>
        </div>
      </section>

      {/* ── Ticket links placeholder ───────────────────────────────────── */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Buy Tickets</h3>
        <div className={styles.placeholder}>
          <p>Coming soon: Ticket links for upcoming games</p>
          <p className={styles.placeholderSub}>
            Links to purchase tickets for each of {current.player}&apos;s next
            10 games will appear here.
          </p>
        </div>
      </section>
    </div>
  );
}
