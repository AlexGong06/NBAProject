import { useState } from "react";
import type { PlayerSummaryFromDatabase } from "../../../utils/types";

interface PlayerRankingRowProps {
  player: PlayerSummaryFromDatabase;
}

export default function PlayerRankingRow({ player }: PlayerRankingRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Helpers for formatting
  const fmtPct = (val: number) => `${(val * 100).toFixed(1)}%`;
  const fmtNum = (val: number) => val.toFixed(1);

  return (
    <li
      style={{
        marginBottom: "1rem",
        border: "1px solid #ccc",
        borderRadius: "8px",
        padding: "10px",
        listStyle: "none",
        backgroundColor: "#fff",
        color: "#213547", // FIX: Explicitly set dark text color
        textAlign: "left", // Optional: keeps text aligned left if App.css centers it
      }}
    >
      {/* Top Header Row: Click to Toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
            #{player.calculatedRank}
          </span>
          <a
            href={player.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            // Stop propagation so clicking the link doesn't toggle the row
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: "1.1rem",
              fontWeight: "600",
              color: "#0070f3",
              textDecoration: "none",
            }}
          >
            {player.player}
          </a>
          <span style={{ color: "#666", fontSize: "0.9rem" }}>
            ({player.team} • {player.teamWins} Wins)
          </span>
        </div>

        <button
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "1.2rem",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
          aria-label={isExpanded ? "Collapse stats" : "Expand stats"}
        >
          ▼
        </button>
      </div>

      {/* Expanded Details Section */}
      {isExpanded && (
        <div
          style={{
            marginTop: "15px",
            paddingTop: "15px",
            borderTop: "1px solid #eee",
            display: "flex",
            gap: "20px",
          }}
        >
          {/* Image Placeholder */}
          <div
            style={{
              width: "80px",
              height: "80px",
              backgroundColor: "#f0f0f0",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.8rem",
              color: "#888",
              flexShrink: 0,
            }}
          >
            Image
          </div>

          {/* Stats Grid */}
          <div style={{ flex: 1 }}>
            <h4
              style={{ margin: "0 0 10px 0", fontSize: "1rem", color: "#333" }}
            >
              Season Stats
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                gap: "10px",
                fontSize: "0.9rem",
              }}
            >
              <div>
                <strong>PPG:</strong> {fmtNum(player.pointsPerGame)}
              </div>
              <div>
                <strong>RPG:</strong> {fmtNum(player.reboundsPerGame)}
              </div>
              <div>
                <strong>APG:</strong> {fmtNum(player.assistsPerGame)}
              </div>
              <div>
                <strong>SPG:</strong> {fmtNum(player.stealsPerGame)}
              </div>
              <div>
                <strong>BPG:</strong> {fmtNum(player.blocksPerGame)}
              </div>

              <div>
                <strong>TS%:</strong> {fmtPct(player.trueShootingPercentage)}
              </div>
              <div>
                <strong>WS:</strong> {fmtNum(player.winShare)}
              </div>
              <div>
                <strong>BPM:</strong> {fmtNum(player.boxPlusMinus)}
              </div>
              <div>
                <strong>VORP:</strong> {fmtNum(player.valueOverReplacement)}
              </div>
              <div>
                <strong>TOV:</strong> {fmtNum(player.turnoversPerGame)}
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
