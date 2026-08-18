// Captures the two-player proof fixture from the live NBA API.
//
// Run once (`npx ts-node scripts/generate-two-player-fixture.ts`) to refresh
// test/fixtures/two-player-season-2025-26.json. The test that consumes it runs
// offline: a proof that only holds while stats.nba.com is reachable is not a
// regression test, it is a status check.
//
// Only two players are kept, plus every team game for the four teams involved,
// because team context is what the traded-player case actually exercises.

import { writeFileSync } from "fs";
import { join } from "path";
import { fetchSeason } from "../src/services/nba-api/fetch-season";

const SEASON = "2025-26";
const PLAYERS = ["Nikola Jokić", "James Harden"];

async function main() {
  const season = await fetchSeason(SEASON);

  const playerGames = season.playerGames.filter((g) =>
    PLAYERS.includes(g.playerName),
  );
  if (playerGames.length === 0) {
    throw new Error(`No games found for ${PLAYERS.join(", ")} — name mismatch?`);
  }

  // Every team either player appeared for, so a mid-season trade keeps both
  // stints intact.
  const teamIds = new Set(playerGames.map((g) => g.teamId));
  const teamGames = season.teamGames.filter((g) => teamIds.has(g.teamId));

  const out = { season: SEASON, capturedAt: new Date().toISOString(), playerGames, teamGames };
  const path = join(__dirname, "..", "test", "fixtures", "two-player-season-2025-26.json");
  writeFileSync(path, JSON.stringify(out, null, 2));

  const byPlayer = new Map<string, number>();
  for (const g of playerGames) {
    byPlayer.set(g.playerName, (byPlayer.get(g.playerName) ?? 0) + 1);
  }
  console.log(`Wrote ${path}`);
  console.log(`  players    ${[...byPlayer].map(([n, c]) => `${n} ${c}g`).join(", ")}`);
  console.log(`  teams      ${[...teamIds].join(", ")}`);
  console.log(`  teamGames  ${teamGames.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
