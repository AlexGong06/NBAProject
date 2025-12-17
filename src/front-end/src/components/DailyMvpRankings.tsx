import { useEffect, useState } from "react";
import type { PlayerSummaryFromDatabase } from "../../../utils/types";

const API_BASE_URL = "http://localhost:3000";

export default function DailyMvpRankings() {
  const [rankings, setRankings] = useState<PlayerSummaryFromDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/daily-mvp-rankings`);

        if (!res.ok) {
          throw new Error("Failed to fetch MVP rankings");
        }

        const data: PlayerSummaryFromDatabase[] = await res.json();

        // Since backend sorts by date desc,
        // take the most recent date only
        const latestDate = data[0]?.date;

        const latestRankings = data
          .filter((r) => r.date === latestDate)
          .sort((a, b) => a.calculatedRank - b.calculatedRank); // rank 1 first

        setRankings(latestRankings);
      } catch (err) {
        setError("Unable to load MVP rankings" + err);
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, []);

  if (loading) return <p>Loading MVP rankings…</p>;
  if (error) return <p>{error}</p>;

  return (
    <div>
      <h2>Daily MVP Rankings</h2>
      <ol>
        {rankings.map((player) => (
          <li>{player.player}</li>
        ))}
      </ol>
    </div>
  );
}
