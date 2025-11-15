import { Page } from "playwright";
import { wait } from "../utils/wait";
import { PlayerSummary } from "../utils/types";


export async function fetchPlayerAdvancedStats(
  page: Page,
  player: PlayerSummary
): Promise<PlayerSummary> {

  // Navigate to the player profile page
  await page.goto(player.profileUrl, { waitUntil: "domcontentloaded" });

  // Basketball Reference always exposes advanced stats inside #all_advanced
  // but the target row is simply identified by the ID pattern "advanced.YYYY"
  const season = 2026; // replace with dynamic season if needed
  const rowId = `advanced.${season}`;

  // Execute scraping inside browser context
  const stats = await page.evaluate((rowId) => {
    const row = document.querySelector(`tr#${CSS.escape(rowId)}`);
    if (!row) return null; // Player may not have advanced stats for season

    const get = (stat) => {
      const cell = row.querySelector(`td[data-stat='${stat}']`);
      if (!cell) return null;
      const raw = cell.textContent?.trim() || "";
      return raw === "" ? null : parseFloat(raw.replace("%", ""));
    };

    return {
      trueShootingPercentage: get("ts_pct"),  // .773
      usageRate: get("usg_pct"),              // 27.0
      winShare: get("ws"),                    // 3.6
      boxPlusMinus: get("bpm"),               // 20.8
      valueOverReplacement: get("vorp"),      // 2.2
    };
  }, rowId);

  if (!stats) {
    console.warn(`Could not find advanced stats row for ${player.player}`);
    return player;
  }
  await wait(5000);
  // Merge stats into the player object
  return {
    ...player,
    ...stats,
  };
}