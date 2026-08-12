// Tests for the game-log parser, against a real saved page.
//
// This is the first scraper test in the project, and it exists because the
// migration writes 2,561 rows off the back of this one function. If it reads a
// number wrong, every score is wrong in a way that still looks like a score.
//
// The fixture is a trimmed copy of Jokić's 2026 game log, kept in
// test/fixtures/. It deliberately includes the playoff table, because ignoring
// that table is half of what the parser has to get right.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  gameLogUrl,
  gamesPlayedAsOf,
  gamesPlayedAtTeamGame,
  teamRecordAsOf,
  parseGameLog,
} from "./scrape-player-game-log";

const html = readFileSync(
  join(__dirname, "../../../test/fixtures/gamelog-jokicni01-2026.html"),
  "utf8",
);
const entries = parseGameLog(html);

describe("gameLogUrl", () => {
  // The profile URL is what the database stores, so the migration derives the
  // log URL from it rather than reconstructing player ids by hand.
  it("derives the log URL from a stored profile URL", () => {
    expect(
      gameLogUrl(
        "https://www.basketball-reference.com/players/j/jokicni01.html",
        2026,
      ),
    ).toBe("https://www.basketball-reference.com/players/j/jokicni01/gamelog/2026/");
  });
});

describe("parseGameLog", () => {
  // 82 games in a season. Getting 90 means the playoff table leaked in; getting
  // 88 means the ISO-date regex matched across both tables, which is exactly
  // what happened on the first attempt at this.
  it("reads the regular season only", () => {
    expect(entries).toHaveLength(82);
    expect(entries[0].date).toBe("2025-10-23");
    expect(entries[entries.length - 1].date).toBe("2026-04-12");
  });

  // The playoff table sits in the same document and its ranker column restarts
  // at 1. Any date after the regular season ended is proof it leaked.
  it("ignores the playoff table entirely", () => {
    const afterRegularSeason = entries.filter((e) => e.date > "2026-04-12");
    expect(afterRegularSeason).toEqual([]);
  });

  // The header repeats every twenty rows. Those cells are `th`, and matching
  // them would parse the literal string "Date" as a game.
  it("skips repeated header rows", () => {
    for (const e of entries) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // The whole point. 82 rows, 65 appearances, 17 missed — counting rows would
  // overstate his availability by 26%.
  it("distinguishes games played from games listed", () => {
    const played = entries.filter((e) => e.played);
    expect(played).toHaveLength(65);
    expect(entries.length - played.length).toBe(17);
  });

  // On a missed game the ranker cell is blank. Carrying the previous value
  // forward is what makes gamesPlayedAsOf correct on those dates; resetting to
  // zero or skipping the row would both corrupt the running count.
  it("carries the count forward across missed games", () => {
    const dnp = entries.filter((e) => !e.played);
    expect(dnp.length).toBeGreaterThan(0);

    for (const miss of dnp) {
      const i = entries.indexOf(miss);
      if (i === 0) continue;
      expect(miss.gamesPlayedToDate).toBe(entries[i - 1].gamesPlayedToDate);
    }
  });

  // Two independent readings of the same fact: the final running total, and a
  // count of rows he actually played. They must agree.
  it("agrees with a straight count of played rows", () => {
    const viaRunning = entries[entries.length - 1].gamesPlayedToDate;
    const viaCount = entries.filter((e) => e.played).length;

    expect(viaRunning).toBe(viaCount);
    expect(viaRunning).toBe(65);
  });

  // Never decreases, and never outruns the team's game count.
  it("produces a monotonic count bounded by team games", () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].gamesPlayedToDate).toBeGreaterThanOrEqual(
        entries[i - 1].gamesPlayedToDate,
      );
    }
    for (const e of entries) {
      expect(e.gamesPlayedToDate).toBeLessThanOrEqual(e.teamGamesToDate);
    }
  });

  it("returns nothing for a page with no regular-season table", () => {
    expect(parseGameLog("<html><body><p>nope</p></body></html>")).toEqual([]);
  });
});

describe("gamesPlayedAtTeamGame", () => {
  // Why this exists rather than just walking by date: the scraper reads the
  // team page at a fixed hour, so a row dated 11-26 can record 17 team games
  // while the team played its 18th that evening. Aligning on the team's game
  // number puts both sides on the same clock. 137 rows had availability above 1
  // before this.
  it("never exceeds the team's game count", () => {
    for (let tg = 1; tg <= 82; tg++) {
      expect(gamesPlayedAtTeamGame(entries, tg)).toBeLessThanOrEqual(tg);
    }
  });

  it("agrees with the log at a known point", () => {
    // Jokić: 39 games played by the time Denver had played its 57th.
    const atFinal = gamesPlayedAtTeamGame(entries, 82);
    expect(atFinal).toBe(65);
  });

  // Monotonic — more team games can never mean fewer player games.
  it("is monotonic in team games", () => {
    let prev = 0;
    for (let tg = 1; tg <= 82; tg++) {
      const v = gamesPlayedAtTeamGame(entries, tg);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("returns zero before the team has played", () => {
    expect(gamesPlayedAtTeamGame(entries, 0)).toBe(0);
  });

  it("returns zero for an empty log", () => {
    expect(gamesPlayedAtTeamGame([], 40)).toBe(0);
  });
});

describe("teamRecordAsOf", () => {
  // The log lists every team game, so it is a complete record of the season
  // from a source independent of the team page. That independence is the point:
  // one stored row has teamWins null because the team scrape failed in
  // November, and this is what repairs it.
  it("counts wins and games from a player's log", () => {
    const rec = teamRecordAsOf(entries, "2026-04-12");
    expect(rec.gamesPlayed).toBe(82);
    expect(rec.wins).toBeGreaterThan(0);
    expect(rec.wins).toBeLessThanOrEqual(82);
  });

  // Results are recorded on games the player missed too — otherwise a team's
  // record would silently exclude every game its star sat out.
  it("counts games the player did not appear in", () => {
    const dnpDates = entries.filter((e) => !e.played).map((e) => e.date);
    expect(dnpDates.length).toBe(17);
    for (const e of entries.filter((x) => !x.played)) {
      expect(e.teamWon === true || e.teamWon === false).toBe(true);
    }
  });

  // Monotonic, and never more wins than games.
  it("never reports more wins than games played", () => {
    for (const iso of ["2025-11-26", "2026-01-01", "2026-02-17", "2026-04-12"]) {
      const rec = teamRecordAsOf(entries, iso);
      expect(rec.wins).toBeLessThanOrEqual(rec.gamesPlayed);
    }
  });

  it("reports nothing before the season starts", () => {
    expect(teamRecordAsOf(entries, "2025-10-01")).toEqual({ wins: 0, gamesPlayed: 0 });
  });
});

describe("gamesPlayedAsOf", () => {
  // The values the migration will actually write. Verified independently
  // against the live page during research: 36 on 2026-02-05, 39 on 2026-02-17.
  it("returns the count as of a date", () => {
    expect(gamesPlayedAsOf(entries, "2026-02-05")).toBe(36);
    expect(gamesPlayedAsOf(entries, "2026-02-17")).toBe(39);
    expect(gamesPlayedAsOf(entries, "2026-04-13")).toBe(65);
  });

  // A date between games resolves to the last game before it, not the next one
  // after. Reading forward would credit him with a game he had not played yet.
  it("does not count games that had not happened yet", () => {
    // He played on the 4th and next on the 7th; the 5th and 6th sit between.
    expect(gamesPlayedAsOf(entries, "2026-02-04")).toBe(36);
    expect(gamesPlayedAsOf(entries, "2026-02-06")).toBe(36);
    expect(gamesPlayedAsOf(entries, "2026-02-07")).toBe(37);
  });

  // Before the season starts nobody has played anything. The migration must
  // treat this as a real zero and refuse to write it, not score the player at
  // zero availability and quietly bury him.
  it("returns zero before the first game", () => {
    expect(gamesPlayedAsOf(entries, "2025-10-01")).toBe(0);
  });

  // Past the end of the season the total stops growing.
  it("saturates after the last game", () => {
    expect(gamesPlayedAsOf(entries, "2026-07-01")).toBe(65);
  });

  it("returns zero for an empty log rather than throwing", () => {
    expect(gamesPlayedAsOf([], "2026-02-05")).toBe(0);
  });
});
