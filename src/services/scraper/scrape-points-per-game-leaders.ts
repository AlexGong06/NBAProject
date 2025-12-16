import { Page } from "playwright";
import {
  PpgPlayerSummary,
  PpgPlayerSummaryArraySchema,
} from "../../utils/types";
import { wait } from "../../utils/wait";
import logger from "../../utils/logger";

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

    const rows = Array.from(container.querySelectorAll("div span.rank")).map(
      (r) => r.parentElement
    );

    return rows
      .map((row) => {
        const whoCell = row.querySelector("span.who a");
        // Player link lives inside span.who > a
        if (!whoCell) return null;

        const player = whoCell.textContent?.trim() ?? "";
        const profileUrl = whoCell.getAttribute("href") ?? "";

        // Points per game lives inside span.value
        const ppgCell = row.querySelector("span.value");
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

  // Validate with Zod
  const result = PpgPlayerSummaryArraySchema.safeParse(players);

  if (!result.success) {
    logger.error("PPG leader validation failed");
    logger.error(result.error.format());
    throw new Error("PPG leader validation failed");
  }

  logger.info("displaying PPG leaders");
  logger.info(result.data); // parsed / validated
  await wait(2000);

  return result.data; // strongly typed as PpgPlayerSummary[]
}
