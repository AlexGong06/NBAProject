import { describe, expect, it } from "vitest";
import { formatDuration, parseHighlightTitle } from "./highlight-title";

// Every title below is real, taken from the NBA's
// "Nightly Full Game Highlights | 2025-26 Season" playlist.
describe("parseHighlightTitle", () => {
  it("reads the standard form", () => {
    expect(
      parseHighlightTitle("NUGGETS at WARRIORS | FULL GAME HIGHLIGHTS | October 23, 2025"),
    ).toEqual({ awayAbbr: "DEN", homeAbbr: "GSW", isoDate: "2025-10-23" });
  });

  // 66 NBA Cup group games carry a sponsor tag in the middle. They count in the
  // standings, so they are among the season's 1,230 games — rejecting them for
  // the extra segment costs 5 percentage points of coverage.
  it("reads a title with an event tag between the teams and the format", () => {
    expect(
      parseHighlightTitle(
        "THUNDER at KINGS | EMIRATES NBA CUP 🏆 | FULL GAME HIGHLIGHTS | November 7, 2025",
      ),
    ).toEqual({ awayAbbr: "OKC", homeAbbr: "SAC", isoDate: "2025-11-07" });
  });

  it("reads the other event tags the playlist uses", () => {
    for (const tag of ["SoFi Play-In Tournament", "NBA ABU DHABI GAMES", "NBA CHINA GAMES"]) {
      expect(
        parseHighlightTitle(`LAKERS at CELTICS | ${tag} | FULL GAME HIGHLIGHTS | March 1, 2026`),
      ).toEqual({ awayAbbr: "LAL", homeAbbr: "BOS", isoDate: "2026-03-01" });
    }
  });

  // A longer re-cut of a game that already has a standard reel. Excluded on
  // purpose — the app plays the nightly reel, not the extended one.
  it("rejects an EXTENDED re-cut", () => {
    expect(
      parseHighlightTitle(
        "EXTENDED: NUGGETS at THUNDER | FULL GAME HIGHLIGHTS | March 9, 2026",
      ),
    ).toBeNull();
  });

  // Both of these are misspellings in the NBA's own titles, and both are the
  // only reel for their game. Dropping them to punish a typo loses real footage.
  it("survives the two typos in the source data", () => {
    expect(
      parseHighlightTitle("GRIZZLES at PACERS | FULL GAME HIGHLIGHTS | March 1, 2026"),
    ).toEqual({ awayAbbr: "MEM", homeAbbr: "IND", isoDate: "2026-03-01" });

    expect(
      parseHighlightTitle("BULLS at TRAIL BLAZZERS | FULL GAME HIGHLIGHTS | November 19, 2025"),
    ).toEqual({ awayAbbr: "CHI", homeAbbr: "POR", isoDate: "2025-11-19" });
  });

  it("handles two-word and numeric nicknames", () => {
    expect(parseHighlightTitle("76ERS at TRAIL BLAZERS | FULL GAME HIGHLIGHTS | January 3, 2026"))
      .toEqual({ awayAbbr: "PHI", homeAbbr: "POR", isoDate: "2026-01-03" });
  });

  it("tolerates a trailing (edited) marker", () => {
    expect(
      parseHighlightTitle("BUCKS at SUNS | FULL GAME HIGHLIGHTS | March 21, 2026 (edited)"),
    ).toEqual({ awayAbbr: "MIL", homeAbbr: "PHX", isoDate: "2026-03-21" });
  });

  // The reason this returns null rather than a best guess: an unparsed title
  // costs one game its video, a wrong parse shows the wrong game under the
  // right scoreline.
  it("returns null for anything that is not a full-game reel", () => {
    const notGames = [
      "Victor Wembanyama Youngest Player in NBA History with a 40+ PT 20+ REB Playoff Game",
      "Wow Mark Williams 😱",
      "Giannis Antetokounmpo Was BALLING vs Cavaliers | October 26, 2025",
      "SPURS vs KNICKS | EMIRATES NBA CUP CHAMPIONSHIP 🏆 | FULL GAME HIGHLIGHTS | December 16, 2025",
      "NUGGETS at WARRIORS | TOP 10 PLAYS | October 23, 2025",
      "",
      null,
      undefined,
    ];
    for (const t of notGames) expect(parseHighlightTitle(t)).toBeNull();
  });

  it("returns null for an unknown nickname rather than guessing", () => {
    expect(
      parseHighlightTitle("SUPERSONICS at WARRIORS | FULL GAME HIGHLIGHTS | October 23, 2025"),
    ).toBeNull();
  });

  // A title claiming a team played itself is a parse gone wrong, not a game.
  it("refuses a fixture against itself", () => {
    expect(
      parseHighlightTitle("LAKERS at LAKERS | FULL GAME HIGHLIGHTS | October 23, 2025"),
    ).toBeNull();
  });

  // Away first, matching the "at" in the title. Getting this backwards would
  // match every fixture to its mirror and swap home and away on 1,230 games.
  it("puts the away team first", () => {
    const p = parseHighlightTitle("LAKERS at CELTICS | FULL GAME HIGHLIGHTS | January 1, 2026")!;
    expect(p.awayAbbr).toBe("LAL");
    expect(p.homeAbbr).toBe("BOS");
  });

  it("zero-pads the date into the stored form", () => {
    expect(parseHighlightTitle("HEAT at MAGIC | FULL GAME HIGHLIGHTS | January 3, 2026")!.isoDate)
      .toBe("2026-01-03");
  });
});

describe("formatDuration", () => {
  it("formats the common case", () => {
    expect(formatDuration("PT8M12S")).toBe("8:12");
  });

  it("pads seconds so 8:05 is not read as 8:50", () => {
    expect(formatDuration("PT8M5S")).toBe("8:05");
  });

  it("adds an hour component only when there is one", () => {
    expect(formatDuration("PT1H2M3S")).toBe("1:02:03");
    expect(formatDuration("PT45S")).toBe("0:45");
    expect(formatDuration("PT10M")).toBe("10:00");
  });

  it("returns an empty label rather than a wrong one", () => {
    for (const bad of ["", "8:12", "PT", null, undefined]) {
      expect(formatDuration(bad)).toBe("");
    }
  });
});
