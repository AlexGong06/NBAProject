import { chromium, Page } from "playwright";
import { wait } from "./wait";

export async function scrapeDailyStatsLeaders() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("https://www.basketball-reference.com/");
    await wait(2000)
    await page.goto("https://www.basketball-reference.com/leagues/NBA_2026_leaders.html");
    await wait(5000);
    
    const data = await page.evaluate(() => {
        const categories = Array.from(document.querySelectorAll("div.data_grid_box"));
        const results: any[] = [];
    
        for (const category of categories) {
          const subjectEl = category.querySelector("[data-tip]");
          const subject = subjectEl ? subjectEl.getAttribute("data-tip") : "Unknown";
    
          const rows = Array.from(category.querySelectorAll("table.columns tbody tr"));
          const players = [];
    
          for (const row of rows) {
            const rank = row.querySelector("td.rank")?.textContent?.trim() || "";
            const playerName = row.querySelector("td.who a")?.textContent?.trim() || "";
            const team = row.querySelector("td.who .desc")?.textContent?.trim() || "";
            const value = row.querySelector("td.value")?.textContent?.trim() || "";
    
            // Only include if data exists and rank is within top 10
            const rankNum = parseInt(rank.replace(".", ""), 10);
            if (!isNaN(rankNum) && rankNum <= 10) {
              players.push({ Rank: rank, Player: playerName, Team: team, Value: value });
            }
          }
    
          results.push({ Subject: subject, Players: players });
        }
    
        return results;
    });
    await browser.close()
    return data;
}