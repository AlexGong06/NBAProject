import { useState } from "react";
import type { PlayerSummaryFromDatabase } from "../../../utils/types";
import styles from "./PlayerRankingsRow.module.css";

interface PlayerRankingRowProps {
  player: PlayerSummaryFromDatabase;
}

export default function PlayerRankingRow({ player }: PlayerRankingRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 1. Extract Player ID from profileUrl
  // Example: https://www.basketball-reference.com/players/g/gilgesh01.html -> gilgesh01
  const playerId =
    player.profileUrl.split("/").pop()?.replace(".html", "") || "";

  // 2. Construct the Image URL using the Basketball-Reference pattern
  const imageUrl = `https://www.basketball-reference.com/req/202106291/images/headshots/${playerId}.jpg`;

  const fmtPct = (val: number) => `${(val * 100).toFixed(1)}%`;
  const fmtNum = (val: number) => val.toFixed(1);

  return (
    <li className={styles.card}>
      <div className={styles.header} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.infoGroup}>
          <span className={styles.rank}>#{player.calculatedRank}</span>
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
        <button
          className={`${styles.toggleBtn} ${isExpanded ? styles.expanded : ""}`}
        >
          ▼
        </button>
      </div>

      {isExpanded && (
        <div className={styles.details}>
          {/* 3. Updated Image Tag */}
          <div className={styles.avatarContainer}>
            <img
              src={imageUrl}
              alt={player.player}
              className={styles.playerImage}
              // Handle cases where an image might not exist
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  "https://via.placeholder.com/80?text=No+Photo";
              }}
            />
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
