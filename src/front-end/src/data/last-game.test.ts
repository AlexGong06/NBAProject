import { describe, expect, it } from "vitest";
import { daysBeforeLabel, scoreline, shortDate, venueLabel } from "./last-game";

describe("shortDate", () => {
  it("formats a date key", () => {
    expect(shortDate("12-29-2025")).toBe("Dec 29");
    expect(shortDate("1-3-2026")).toBe("Jan 3");
  });

  it("returns the key unchanged when it cannot be parsed", () => {
    expect(shortDate("nonsense")).toBe("nonsense");
  });
});

// The chip is dated from the board, not from the clock. Measuring from `now`
// would make the same game read differently depending on when the page was
// opened — and every one of these labels would drift as the season aged.
describe("daysBeforeLabel", () => {
  it("names the same day", () => {
    expect(daysBeforeLabel("1-20-2026", "1-20-2026")).toBe("That night");
  });

  it("names the day before", () => {
    expect(daysBeforeLabel("1-19-2026", "1-20-2026")).toBe("Yesterday");
  });

  // Jokić missed twelve straight Denver games after 29 December, so on a
  // 20 January board his most recent game is three weeks old. Without this the
  // chip reads as last night's result.
  it("counts a long absence", () => {
    expect(daysBeforeLabel("12-29-2025", "1-20-2026")).toBe("22 days earlier");
  });

  it("crosses a month and a year boundary", () => {
    expect(daysBeforeLabel("12-31-2025", "1-1-2026")).toBe("Yesterday");
  });

  // Dates are built at local noon precisely so the March daylight-saving shift
  // cannot turn N days into N ± 1 after rounding.
  it("is exact across the daylight-saving boundary", () => {
    expect(daysBeforeLabel("3-7-2026", "3-9-2026")).toBe("2 days earlier");
    expect(daysBeforeLabel("3-8-2026", "3-9-2026")).toBe("Yesterday");
  });

  // A game cannot be played after the date being viewed, but a bad URL can ask
  // for one. "That night" is a safer reading than a negative count.
  it("does not report a negative number of days", () => {
    expect(daysBeforeLabel("1-21-2026", "1-20-2026")).toBe("That night");
  });

  it("returns nothing rather than guessing on an unparseable key", () => {
    expect(daysBeforeLabel("", "1-20-2026")).toBe("");
  });
});

describe("venueLabel", () => {
  it("distinguishes home from away", () => {
    expect(venueLabel({ home: true, neutralSite: false })).toBe("vs");
    expect(venueLabel({ home: false, neutralSite: false })).toBe("@");
  });

  // Five games in 2025-26 were played where neither side hosted — the NBA Cup
  // games in Las Vegas among them. The scoreboard still nominates a home team
  // for stat purposes, so `home` is set and would otherwise be printed as fact.
  it("marks a neutral site rather than trusting the home flag", () => {
    expect(venueLabel({ home: true, neutralSite: true })).toBe("N");
    expect(venueLabel({ home: false, neutralSite: true })).toBe("N");
  });
});

describe("scoreline", () => {
  it("joins the two scores with an en dash", () => {
    expect(scoreline({ teamScore: 116, opponentScore: 114, overtime: false })).toBe("116–114");
  });

  it("marks overtime", () => {
    expect(scoreline({ teamScore: 128, opponentScore: 125, overtime: true })).toBe("128–125 OT");
  });
});
