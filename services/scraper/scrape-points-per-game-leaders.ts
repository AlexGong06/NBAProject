import { Page } from "playwright";
import { PpgPlayerSummary } from "../utils/types";
import { wait } from "../utils/wait";

export async function scrapePpgLeaders(data: {
  page: Page;
}): Promise<PpgPlayerSummary[]> {
  // Navigate to the leaders page
  await data.page.goto(
    "https://www.basketball-reference.com/leagues/NBA_2026_leaders.html",
    { waitUntil: "domcontentloaded" }
  );

  // Extract PPG leaders directly from the DOM
  const players = await data.page.evaluate(() => {
    const container = document.querySelector("#leaders_pts_per_g");
    if (!container) return [];

    const rows = Array.from(
      container.querySelectorAll("table.columns tbody tr")
    );

    return rows
      .map((row) => {
        // Player link lives inside td.who > a
        const whoCell = row.querySelector("td.who a");
        if (!whoCell) return null;

        const player = whoCell.textContent?.trim() ?? "";
        const profileUrl = whoCell.getAttribute("href") ?? "";

        // Points per game lives inside td.value
        const ppgCell = row.querySelector("td.value");
        const ppgRaw = ppgCell?.textContent?.trim() ?? "";
        const pointsPerGame = parseFloat(ppgRaw);

        if (!player || !profileUrl || isNaN(pointsPerGame)) {
          return null;
        }

        return {
          player,
          profileUrl: "https://www.basketball-reference.com" + profileUrl,
          pointsPerGame,
        };
      })
      .filter(Boolean) as {
      player: string;
      profileUrl: string;
      pointsPerGame: number;
    }[];
  });
  await wait(2000);
  console.log("displaying PPG leaders");
  console.dir(players, { depth: null });
  return players;
}
