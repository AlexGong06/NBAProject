import { describe, expect, it } from "vitest";
import { isoDate, parseMatchup } from "./fetch-season";

describe("parseMatchup", () => {
  it("reads an away game", () => {
    expect(parseMatchup("NOP @ MIN")).toEqual({ opponentAbbr: "MIN", isHome: false });
  });

  it("reads a home game", () => {
    expect(parseMatchup("TOR vs. BKN")).toEqual({ opponentAbbr: "BKN", isHome: true });
  });

  // The separator is the only thing distinguishing the two, and "vs." carries a
  // trailing period that "@" does not. Matching loosely on "vs" would also match
  // a team abbreviation, so the pattern is anchored.
  it("does not confuse the separator with a team code", () => {
    expect(parseMatchup("VAN vs. UTA").opponentAbbr).toBe("UTA");
  });

  // A game silently labelled "home" is worse than one labelled nothing: nobody
  // audits a plausible label. Anything unparseable returns nulls.
  it("returns nulls rather than guessing", () => {
    for (const bad of ["", "DEN", "DEN - GSW", "Denver at Golden State", null, undefined]) {
      expect(parseMatchup(bad)).toEqual({ opponentAbbr: null, isHome: null });
    }
  });

  // Five games in 2025-26 are played at neutral sites — the NBA Cup games in
  // Las Vegas among them — and there BOTH teams read "@". The opponent is still
  // correct; only the side is meaningless, which is why GameSummaries2526 is
  // authoritative for home/away and this field is only a fallback.
  it("reports both sides as away for a neutral-site game", () => {
    expect(parseMatchup("SAS @ OKC").isHome).toBe(false);
    expect(parseMatchup("OKC @ SAS").isHome).toBe(false);
  });
});

describe("isoDate", () => {
  // Comparing "2026-04-12T00:00:00" against "2026-04-12" is true for `<` and
  // false for `<=`, which silently drops the last day of any range — 64 games
  // instead of 65.
  it("strips the time the API appends", () => {
    expect(isoDate("2026-04-12T00:00:00")).toBe("2026-04-12");
  });

  it("leaves a bare date alone", () => {
    expect(isoDate("2026-04-12")).toBe("2026-04-12");
  });
});
