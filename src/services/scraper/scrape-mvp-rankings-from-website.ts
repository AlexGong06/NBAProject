import { chromium } from "playwright";
import { wait } from "../../utils/wait";
import { PlayerMvpSummary } from "../../utils/types";
import logger from "../../utils/logger";

export async function scrapeMvpRankingsFromWebsite(): Promise<
  PlayerMvpSummary[]
> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto("https://www.basketball-reference.com/friv/mvp.html", {
    waitUntil: "domcontentloaded",
  });

  const data: PlayerMvpSummary[] = await page.evaluate(() => {
    // Helper function to run XPath inside the browser context
    function getXPathElements(xpath: string): HTMLElement[] {
      const results: HTMLElement[] = [];
      const query = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      for (let i = 0; i < query.snapshotLength; i++) {
        const node = query.snapshotItem(i) as HTMLElement;
        if (node) results.push(node);
      }
      return results;
    }

    // Select only the <tr> elements representing players (skip header)
    const playerRows = getXPathElements(
      "//tbody/tr[th[@data-stat='ranker' and @class='right ']]"
    );

    const players = playerRows.map((row) => {
      const getText = (selector: string) => {
        return (row.querySelector(selector)?.textContent || "").trim();
      };

      const linkEl = row.querySelector(
        "td[data-stat='player'] a"
      ) as HTMLAnchorElement;
      const profileUrl = linkEl?.href || "";
      const websiteRanking = getText("th[data-stat='ranker']");
      const player = getText("td[data-stat='player']");
      const teamWins = parseInt(getText("td[data-stat='wins']"), 10);
      const teamGamesPlayed = parseInt(getText("td[data-stat='g']"), 10);
      const gamesStarted = parseInt(getText("td[data-stat='gs']"), 10);
      const minutesPerGame = parseFloat(getText("td[data-stat='mp_per_g']"));
      const pointsPerGame = parseFloat(getText("td[data-stat='pts_per_g']"));
      const assistsPerGame = parseFloat(getText("td[data-stat='ast_per_g']"));
      const reboundsPerGame = parseFloat(getText("td[data-stat='trb_per_g']"));
      const blocksPerGame = parseFloat(getText("td[data-stat='blk_per_g']"));
      const stealsPerGame = parseFloat(getText("td[data-stat='stl_per_g']"));
      const foulsPerGame = parseFloat(getText("td[data-stat='pf_per_g']"));
      const turnoversPerGame = parseFloat(getText("td[data-stat='tov_per_g']"));

      return {
        websiteRanking,
        player,
        profileUrl,
        teamWins,
        teamGamesPlayed,
        gamesStarted,
        minutesPerGame,
        pointsPerGame,
        assistsPerGame,
        reboundsPerGame,
        blocksPerGame,
        stealsPerGame,
        foulsPerGame,
        turnoversPerGame,
      };
    });
    return players;
  });
  logger.info("displaying scraped rankings");
  logger.info(data);
  return data;
}
