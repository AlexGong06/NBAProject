// Tests for season labels and the collections they name.
//
// Two of these matter more than the rest. `seasonSuffix` decides which
// collection a write lands in, so a wrong answer writes a season's raw facts
// into another season's collection — and because the documents are
// well-formed, nothing downstream would fail. And `resolveSeasonParam` is the
// boundary between a URL and a database query: if an unknown season fell back
// to the current one, a stale link would serve this season's board labelled as
// last season's.

import { describe, expect, it } from "vitest";
import {
  CURRENT_SEASON,
  SEASONS,
  isKnownSeason,
  isSeasonLabel,
  resolveSeasonParam,
  seasonCollections,
  seasonSuffix,
} from "./season";

describe("isSeasonLabel", () => {
  it("accepts the NBA API's form", () => {
    expect(isSeasonLabel("2025-26")).toBe(true);
    expect(isSeasonLabel("2026-27")).toBe(true);
    expect(isSeasonLabel("1999-00")).toBe(true);
  });

  // The plausible typo. "2025-27" is the right shape, and the NBA API answers
  // it with an empty result set rather than an error — so a pipeline run
  // against it reports "no player games" and looks like an outage.
  it("rejects halves that are not consecutive years", () => {
    expect(isSeasonLabel("2025-27")).toBe(false);
    expect(isSeasonLabel("2025-25")).toBe(false);
    expect(isSeasonLabel("2026-25")).toBe(false);
  });

  it("rejects other shapes", () => {
    expect(isSeasonLabel("2025")).toBe(false);
    expect(isSeasonLabel("2025-2026")).toBe(false);
    expect(isSeasonLabel("25-26")).toBe(false);
    expect(isSeasonLabel("")).toBe(false);
  });
});

describe("seasonSuffix", () => {
  // Pins the existing collection names. `PlayerGameLogs2526` already holds
  // 26,638 rows, so this mapping is a contract with data on disk, not a
  // naming preference.
  it("maps a label to the suffix the collections already use", () => {
    expect(seasonSuffix("2025-26")).toBe("2526");
    expect(seasonSuffix("2026-27")).toBe("2627");
  });

  it("handles the century rollover", () => {
    expect(seasonSuffix("1999-00")).toBe("9900");
  });

  it("throws rather than inventing a suffix", () => {
    expect(() => seasonSuffix("nonsense")).toThrow(/season label/);
  });
});

describe("seasonCollections", () => {
  it("names the per-season raw collections", () => {
    expect(seasonCollections("2025-26")).toEqual({
      logs: "PlayerGameLogs2526",
      summaries: "GameSummaries2526",
    });
    expect(seasonCollections("2026-27")).toEqual({
      logs: "PlayerGameLogs2627",
      summaries: "GameSummaries2627",
    });
  });

  // Two seasons must never resolve to one collection. This is the failure that
  // would merge two seasons' raw facts into a single event source, which no
  // later recompute could separate.
  it("gives every known season a distinct pair", () => {
    const names = SEASONS.flatMap((s) => Object.values(seasonCollections(s)));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("resolveSeasonParam", () => {
  it("defaults to the current season when absent", () => {
    expect(resolveSeasonParam(undefined)).toEqual({ season: CURRENT_SEASON });
    expect(resolveSeasonParam("")).toEqual({ season: CURRENT_SEASON });
    expect(resolveSeasonParam(null)).toEqual({ season: CURRENT_SEASON });
  });

  it("passes through a season this app serves", () => {
    for (const season of SEASONS) {
      expect(resolveSeasonParam(season)).toEqual({ season });
    }
  });

  // The important one. A fallback here would answer a stale `?season=` with a
  // different season's rows, under the requested season's name — and every
  // response in this app is a bare array or object with no season on it, so
  // nothing downstream could detect the substitution.
  it("errors on an unknown season instead of falling back", () => {
    const result = resolveSeasonParam("2019-20");
    expect(result.season).toBeUndefined();
    expect(result.error).toMatch(/Unknown season/);
  });

  it("errors on a non-string", () => {
    expect(resolveSeasonParam(["2025-26"]).error).toMatch(/Unknown season/);
    expect(resolveSeasonParam(2025).error).toMatch(/Unknown season/);
  });

  // A syntactically valid label this deployment has no collections for is
  // still unknown — the point of the explicit list.
  it("rejects a well-formed label that is not in SEASONS", () => {
    expect(isSeasonLabel("2030-31")).toBe(true);
    expect(isKnownSeason("2030-31")).toBe(false);
    expect(resolveSeasonParam("2030-31").error).toBeDefined();
  });
});

describe("SEASONS", () => {
  it("is newest first, so SEASONS[0] is what the app opens on", () => {
    const sorted = [...SEASONS].sort().reverse();
    expect([...SEASONS]).toEqual(sorted);
  });

  it("holds only well-formed labels", () => {
    for (const season of SEASONS) expect(isSeasonLabel(season)).toBe(true);
  });
});
