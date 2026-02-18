import { useState } from "react";
// useNavigate is a React Router hook that gives us a function to
// programmatically change the URL (navigate to a different page).
import { useNavigate } from "react-router-dom";
import type { PlayerSummaryFromDatabase } from "../../../utils/types";
import styles from "./PlayerRankingsRow.module.css";

interface PlayerRankingRowProps {
  player: PlayerSummaryFromDatabase;
}

export default function PlayerRankingRow({ player }: PlayerRankingRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // navigate is a function we call like: navigate("/some/path")
  // It changes the URL and React Router swaps the rendered component.
  const navigate = useNavigate();

  // Extract the player's ID from their profile URL.
  // profileUrl looks like: "https://www.basketball-reference.com/players/g/gilgesh01.html"
  // .split("/").pop() gives us "gilgesh01.html", then we strip the extension.
  const playerId =
    player.profileUrl.split("/").pop()?.replace(".html", "") || "";

  // Basketball-Reference serves headshots at a predictable URL pattern.
  const imageUrl = `https://www.basketball-reference.com/req/202106291/images/headshots/${playerId}.jpg`;

  const fmtPct = (val: number) => `${(val * 100).toFixed(1)}%`;
  const fmtNum = (val: number) => val.toFixed(1);

  // Called when the user clicks the player's avatar image.
  // We navigate to the player's dedicated profile page.
  // encodeURIComponent turns spaces and special characters into URL-safe codes
  // e.g. "LeBron James" → "LeBron%20James"
  const handleImageClick = (e: React.MouseEvent) => {
    // stopPropagation prevents this click from also toggling the expand/collapse,
    // since the image sits inside the clickable details panel.
    e.stopPropagation();
    navigate(`/player/${encodeURIComponent(player.player)}`);
  };

  return (
    <li className={styles.card}>
      {/* ── Collapsed header row — always visible ────────────────────── */}
      <div className={styles.header} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.infoGroup}>
          <span className={styles.rank}>#{player.calculatedRank}</span>

          {/* External link to basketball-reference.com player page.
              stopPropagation so clicking the link doesn't also toggle expand. */}
          <a
            href={player.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={styles.playerName}
          >
            {player.player}
          </a>

          <span className={styles.teamInfo}>
            ({player.team} • {player.teamWins} Wins)
          </span>
        </div>

        {/* Chevron button that rotates 180° when expanded */}
        <button
          className={`${styles.toggleBtn} ${isExpanded ? styles.expanded : ""}`}
        >
          ▼
        </button>
      </div>

      {/* ── Expanded details panel ────────────────────────────────────── */}
      {isExpanded && (
        <div className={styles.details}>
          {/* Avatar with hover overlay.
              When the user hovers, a semi-transparent overlay appears with
              "View Profile" text. Clicking navigates to the player's page. */}
          <div
            className={styles.avatarContainer}
            onClick={handleImageClick}
            title="Click to view player profile"
          >
            <img
              src={imageUrl}
              alt={player.player}
              className={styles.playerImage}
              onError={(e) => {
                // If basketball-reference doesn't have a photo, show a placeholder
                (e.target as HTMLImageElement).src =
                  "https://placehold.co/80x80?text=N/A";
              }}
            />

            {/* Overlay div — hidden by default, slides in on hover via CSS.
                It uses position:absolute over the image (see CSS for details). */}
            <div className={styles.imageOverlay}>
              <span className={styles.overlayText}>View Profile</span>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h4 style={{ margin: "0 0 10px 0" }}>Season Stats</h4>
            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <strong>PPG:</strong> {fmtNum(player.pointsPerGame)}
              </div>
              <div className={styles.statItem}>
                <strong>RPG:</strong> {fmtNum(player.reboundsPerGame)}
              </div>
              <div className={styles.statItem}>
                <strong>APG:</strong> {fmtNum(player.assistsPerGame)}
              </div>
              <div className={styles.statItem}>
                <strong>SPG:</strong> {fmtNum(player.stealsPerGame)}
              </div>
              <div className={styles.statItem}>
                <strong>BPG:</strong> {fmtNum(player.blocksPerGame)}
              </div>
              <div className={styles.statItem}>
                <strong>TS%:</strong> {fmtPct(player.trueShootingPercentage)}
              </div>
              <div className={styles.statItem}>
                <strong>WS:</strong> {fmtNum(player.winShare)}
              </div>
              <div className={styles.statItem}>
                <strong>BPM:</strong> {fmtNum(player.boxPlusMinus)}
              </div>
              <div className={styles.statItem}>
                <strong>VORP:</strong> {fmtNum(player.valueOverReplacement)}
              </div>
              <div className={styles.statItem}>
                <strong>TOV:</strong> {fmtNum(player.turnoversPerGame)}
              </div>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
