// Tests for the front end's fixture data source.
//
// These exist because of a specific near-miss. The MVP formula is written out
// by hand in three places — the backend's calculate-player-value.ts, the
// breakdown() function in fixture.ts, and again inside fixture.ts's SNAPSHOTS
// builder, which recomputes mvpValue inline for each of the 30 days.
//
// Adding the availability factor updated two of the three. The result was a
// leaderboard whose ranks did not match its own scores: rank 3 showed 0.950
// while rank 4 showed 1.294. Nothing failed. The types were satisfied, both
// builds passed, and the backend's 39 tests were green — because none of them
// look at the front end.
//
// Until the formula lives in one module that all three import, these are what
// stand between that class of bug and a user.

import { describe, expect, it } from "vitest";
import { calculatePlayerValue } from "../../../services/mvp-calculation/calculate-player-value";
import type { FullPlayerSummary } from "../../../utils/types";
import {
  DATES,
  MISSING,
  PLAYERS,
  TODAY_KEY,
  breakdown,
  history,
  rankings,
} from "./fixture";

describe("the board agrees with itself", () => {
  // The bug, stated directly. A leaderboard is a sorted list; if position 3
  // scores below position 4 then one of the two numbers on screen is a lie,
  // and there is no way for a reader to tell which.
  it("orders every day's rows by descending score", () => {
    for (const date of DATES) {
      if (MISSING.has(date.key)) continue;
      const rows = rankings(date.key) ?? [];
      expect(rows.length).toBeGreaterThan(0);

      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].mvpValue).toBeLessThanOrEqual(rows[i - 1].mvpValue);
      }
    }
  });

  // calculatedRank is what the UI prints and what day-over-day deltas are
  // computed from. It has to be the row's actual position, not an independent
  // number that happens to agree most of the time.
  it("numbers ranks 1..n in list order on every day", () => {
    for (const date of DATES) {
      if (MISSING.has(date.key)) continue;
      const rows = rankings(date.key) ?? [];
      expect(rows.map((r) => r.calculatedRank)).toEqual(
        rows.map((_, i) => i + 1),
      );
    }
  });
});

describe("fixture matches the backend formula", () => {
  // The load-bearing test. breakdown() is a hand copy of the backend's scoring
  // function, and the "How it works" panel shows its output to the user as an
  // explanation of how the ranking was produced. If the two drift, the panel
  // explains a formula that did not compute the number next to it.
  //
  // Both are called with the same inputs and compared to 10 decimal places.
  it("produces the same score as calculate-player-value for every player", () => {
    for (const p of PLAYERS) {
      const backendInput: FullPlayerSummary = {
        player: p.player,
        profileUrl: `https://www.basketball-reference.com/players/x/${p.team}.html`,
        team: p.team,
        pos: p.pos,
        age: p.age,
        teamWins: p.teamWins,
        teamLosses: p.teamLosses,
        teamGamesPlayed: p.teamGamesPlayed,
        gamesStarted: p.gamesStarted,
        gamesPlayed: p.gamesPlayed,
        minutesPerGame: p.minutesPerGame,
        pointsPerGame: p.pointsPerGame,
        assistsPerGame: p.assistsPerGame,
        reboundsPerGame: p.reboundsPerGame,
        blocksPerGame: p.blocksPerGame,
        stealsPerGame: p.stealsPerGame,
        foulsPerGame: p.foulsPerGame,
        turnoversPerGame: p.turnoversPerGame,
        usageRate: p.usageRate,
        valueOverReplacement: p.valueOverReplacement,
        winShare: p.winShare,
        boxPlusMinus: p.boxPlusMinus,
        trueShootingPercentage: p.trueShootingPercentage,
      };

      expect(breakdown(p).mvpValue).toBeCloseTo(
        calculatePlayerValue(backendInput),
        10,
      );
    }
  });

  // The most recent day is defined as unperturbed — no drift is applied — so
  // the snapshot must reproduce breakdown() exactly. This is what ties the
  // board the user sees to the arithmetic the panel shows them.
  it("shows today's board at the unperturbed season figures", () => {
    for (const row of rankings(TODAY_KEY) ?? []) {
      const p = PLAYERS.find((x) => x.player === row.player);
      expect(p).toBeDefined();
      expect(row.mvpValue).toBeCloseTo(breakdown(p!).mvpValue, 10);
    }
  });
});

describe("availability in the fixture", () => {
  // The fixture is the demo. If every player is an iron man, the availability
  // factor is 1 everywhere and the feature is invisible to anyone who clones
  // the repo and runs it.
  it("includes players who missed real time", () => {
    const partial = PLAYERS.filter((p) => p.gamesPlayed < p.teamGamesPlayed);
    expect(partial.length).toBeGreaterThanOrEqual(3);

    // At least one heavy absence, so the effect is visible rather than subtle.
    expect(Math.min(...PLAYERS.map((p) => p.gamesPlayed / p.teamGamesPlayed)))
      .toBeLessThan(0.7);
  });

  // A player cannot start more games than he appeared in. Guards the fixture
  // against being edited into a state the scraper could never produce, which
  // would make it a misleading stand-in for real data.
  it("never starts more games than it plays", () => {
    for (const p of PLAYERS) {
      expect(p.gamesStarted).toBeLessThanOrEqual(p.gamesPlayed);
      expect(p.gamesPlayed).toBeLessThanOrEqual(p.teamGamesPlayed);
    }
  });

  // The point of the change: raw production and final score disagree, and the
  // gap is availability. Guards against the factor being quietly dropped —
  // without this, every mvpValue would still be a plausible number.
  it("ranks at least one player below his raw production", () => {
    const rows = rankings(TODAY_KEY) ?? [];
    const byRaw = [...PLAYERS]
      .sort((a, b) => breakdown(b).rawValue - breakdown(a).rawValue)
      .map((p) => p.player);

    expect(rows.map((r) => r.player)).not.toEqual(byRaw);
  });
});

describe("missing days", () => {
  // The app's defining behaviour: a day with no scrape is not a day with no
  // candidates. rankings() returns null rather than an empty list so callers
  // cannot accidentally render "no MVP candidates today".
  it("returns null for days the collector missed", () => {
    for (const key of MISSING) {
      expect(rankings(key)).toBeNull();
    }
  });

  // History carries the gap through as an explicit hole rather than closing
  // over it, which is what lets the charts draw a dashed segment instead of a
  // straight line implying continuity that was never measured.
  it("reports gaps in history rather than skipping them", () => {
    const points = history(PLAYERS[0].player, TODAY_KEY, 30);
    const missing = points.filter((p) => p.missing);

    expect(missing.length).toBe(MISSING.size);
    for (const p of missing) {
      expect(p.rank).toBeNull();
      expect(p.score).toBeNull();
    }
  });
});
