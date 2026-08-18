# Rebuild the MVP tracker on the NBA API — by Thursday

## Context

The tracker currently scrapes Basketball Reference once a night for the top ~20
scorers and copies their advanced metrics. Three problems: 15 days were lost
permanently when the scraper failed, candidates are selected by points per game
(the exact signal the project argues is misleading), and the most important half
of the score is somebody else's arithmetic.

The data source is moving to the official NBA stats API, the formula's quality
term becomes `0.4(PIE × 100) + 0.2(NR)`, and the 2025-26 season — complete, nothing
arriving — gets reconstructed retroactively. Deadline: **Thursday afternoon**,
running locally against real data. No deployment, no scheduling.

Design rationale lives in `docs/ARCHITECTURE.md`. This is the execution plan.

---

## What is already verified

Run against the live API during planning. These are measurements, not
assumptions.

**Ingestion is three calls, ~17 seconds, for the whole season.**

| Call | Rows | Time |
|---|---|---|
| `PlayerGameLogs(season, MeasureType=Advanced)` | 26,651 | 9.7s |
| `PlayerGameLogs(season, MeasureType=Base)` | 26,651 | 6.5s |
| `TeamGameLogs(season)` | 2,460 | 0.3s |

582 players, 164 game dates, 2025-10-21 → 2026-04-12.

**Every formula input is present per game.** `PIE`, `NET_RATING`, `OFF_RATING`,
`DEF_RATING`, `USG_PCT`, `TS_PCT`, `POSS`, `MIN` from Advanced; `PTS AST REB BLK
STL PF TOV FGA FTA` from Base; team `WL` per game from TeamGameLogs.

**The formula already runs correctly end to end** for both test cases, at any
date:

```
Jokić     2025-11-30  GP 19/19  avail 1.000  PIE 23.9  NR 14.2  MVP 1.959
          2026-02-15  GP 39/55  avail 0.709  PIE 22.7  NR 11.7  MVP 1.261
          2026-04-12  GP 65/82  avail 0.800  PIE 21.4  NR 10.7  MVP 1.398

Harden    2026-01-15  GP 37/40  avail 0.925  PIE 14.9  NR  0.2  MVP 0.865   (LAC)
          2026-04-12  GP 70/76  avail 0.921  PIE 14.3  NR  1.8  MVP 0.890   (LAC→CLE)
```

Harden splits cleanly — LAC 44 games to 2026-01-30, CLE 26 games from 2026-02-07
— with `TEAM_ABBREVIATION` on every row. Stint-aware team-game counting gives
`availability ≤ 1` at every checkpoint for both players.

### Three traps found while verifying

1. **`GAME_DATE` is `'2026-04-12T00:00:00'`.** Comparing against `"2026-04-12"`
   silently drops the final day — 64 games instead of 65. Slice to `[:10]` or
   parse. This is the project's recurring failure mode: an off-by-one producing
   a plausible number.
2. **Row order differs between Advanced and Base.** They must be joined on
   `(PLAYER_ID, GAME_ID)`, never zipped by index.
3. **Scale — and only two of four fields need changing.** See the section below;
   multiplying all of them breaks true shooting instead.

4. **Per-game values are extreme, and two denominators can be zero.** Also
   below. This one was not obvious until the ranges were measured.

---

## The scale problem, precisely

One real row, Jokić, 2025-12-03:

```json
{ "MIN": 35.3, "PIE": 0.177, "USG_PCT": 0.288,
  "TS_PCT": 0.625, "NET_RATING": 32.1, "POSS": 74 }
```

**Resolution: normalise nothing. Fold the scaling into the formula constants.**

The formula previously wrote `usageFactor = usageRate / 100` because Basketball
Reference gave `28.8`. The NBA API gives `0.288` — which is already the factor.
The `/100` and a `×100` would cancel, so both disappear:

```
usageFactor = USG_PCT          (was usageRate / 100)
```

PIE needs `×100`, and that scaling goes **inside the parentheses** so the 0.4-to-0.2
weighting stays visible:

```
quality of impact = 0.4(PIE × 100) + 0.2(NR)
level of impact   = (wins / games) × (MPG / 48) × USG
```

Collapsing this to `40 × PIE` would be arithmetically identical — verified on
Jokić's season figures, both give `8.560000` — but it hides the weights, and a
future retune to 0.5 would mean writing `50`. Keep the ratio legible.

| Field | API returns | Used as | Transformed at ingestion |
|---|---|---|---|
| `USG_PCT` | `0.288` | the usage factor directly | **no** |
| `PIE` | `0.214` | `× 100` inside the formula | **no** |
| `TS_PCT` | `0.625` | a decimal, as-is | **no** |
| `NET_RATING` | `10.74` | as-is | **no** |

**Nothing is transformed at ingestion.** Stored values are byte-identical to the
API response, so they can be diffed against the source at any time and the
"applied the scale fix twice" failure mode cannot occur. This removes what was
the highest risk in this plan.

One consequence to handle: **`FormulaPanel.tsx` renders
`(${usageRate.toFixed(1)} / 100)`**, which with a raw fraction displays
`0.3 / 100`. One line, but that panel exists to show users the working, so it
cannot be left wrong.

A blanket "multiply every fraction by 100" would still be wrong — it would make
true shooting `62.5` and inflate Total Stats sixty-fold.

## Per-game extremes and zero denominators

Measured across all 26,651 player-games:

```
PIE          min  -11.000   median  0.090   max   6.000
NET_RATING   min -400.000   median  0.000   max 300.000
USG_PCT      min    0.000   median  0.177   max   1.000
TS_PCT       min    0.000   median  0.560   max   1.500
POSS         min    0.000   median 49.000   max 122.000
MIN          min    0.000   median 23.400   max  52.300
```

A single-game PIE of 6.0, or a net rating of −400, is genuine: a two-minute
garbage-time appearance where the denominator is almost nothing. Weighted across
a season these collapse to sane values — season PIE tops out at 0.213 — which is
the concrete argument for the aggregation rule rather than averaging.

Two hard requirements fall out:

- **`POSS = 0` and `MIN = 0` rows exist**, and both are weights. Dividing by a
  zero total produces `NaN` or `Infinity` that propagates into `mvpValue` and
  then sorts unpredictably. Drop zero-minute appearances at ingestion and guard
  the totals anyway.
- **Assert ranges after aggregation, not before.** Per-game inputs are legitimately
  out of range; season-to-date values are not. A season-to-date PIE above ~0.35
  or a usage above ~0.45 means the aggregation weighting is wrong.

---

## Data model: store values, derive ranks

**No `calculatedRank` is stored anywhere.** Rank is a function of a date's rows,
computed when asked. `build-source.ts` already sorts by `mvpValue` and assigns
positions on read, ignoring any rank on the row — storing one is redundant and is
how a board ends up disagreeing with itself.

Two collections:

**`PlayerGameLogs2526`** — raw fact, one row per player per game. The joined
Advanced + Base row, normalised, with `playerId`, `gameId`, ISO `date`, `teamId`.
Deterministic `_id` of `${playerId}:${gameId}` so ingest is idempotent. ~26,651
rows.

**`PlayerDailyValues`** — one row per player per game date, carrying season-to-date
inputs, every `Breakdown` term, `mvpValue`, and `formulaVersion: 3`. Date key
stays `"M-D-YYYY"` via the existing `toDateKey`, because the front end and the
existing routes are built on it. ~95,000 rows.

Storing all 582 at every date is what makes "any top N" possible. The payload is
bounded at the API, not in the database.

---

## Serving

`GET /daily-mvp-rankings?top=50` — Mongo aggregation sorts each date by
`mvpValue` and keeps the top N. Default 50 (~8,200 rows, ~3 MB, comparable to
today's 2.2 MB). `?top=200` or `?top=all` works for a deeper board.

**The front end needs no changes.** It receives `StoredRow[]`, groups by date,
sorts, and ranks — exactly what it does now.

---

## Reuse — do not rewrite

| Keep | Why |
|---|---|
| `src/shared/mvp-formula.ts` | Only `qualityOfImpact` and three `ScoringInput` fields change. The `Breakdown` shape, `num()` guard, divide-by-zero guards and `combine()` all stay. |
| `src/utils/date-key.ts` + test | 100% reusable at the API/display boundary. |
| `scripts/migrate-formula-v2.ts` skeleton | dry-run → backup to `backups/` → `bulkWrite(ops, {ordered:false})`. Lift wholesale; the sequential `replaceOne` in `insert-data-into-database.ts` will not survive 95,000 rows. |
| `src/front-end/src/data/` — `types.ts`, `build-source.ts` | Emit `StoredRow[]` and the entire React app is untouched. |
| `vitest.config.ts`, `test/fixtures/` pattern, `src/utils/logger.ts` | Fine as-is. Save one API response as a fixture so parser tests need no network. |
| `scripts/nba-api-probe.py` | Ground truth when a response looks wrong. |

---

## Phases

**Phase 1 — client + the two-player proof.** `src/services/nba-api/client.ts`
(fetch + the verified header set; `Referer` must be `https://www.nba.com/`, and
do *not* send `x-nba-stats-origin`) and `fetch-season.ts` for the three calls.
Join on `(PLAYER_ID, GAME_ID)`, normalise fractions, write
`PlayerGameLogs2526`. Then `scripts/verify-two-players.ts` reproducing the Jokić
and Harden tables above as a committed test.
*Gate: both players match, `availability ≤ 1` everywhere.*

**Phase 2 — formula v3.** In `src/shared/mvp-formula.ts`: `qualityOfImpact`
becomes `0.4 * (pie * 100) + 0.2 * netRating`, `usageFactor` becomes `usageRate`
with no division, and `ScoringInput` swaps `valueOverReplacement`/`winShare`/
`boxPlusMinus` for `pie`/`netRating`. Update `BreakdownSchema`, bump
`CURRENT_FORMULA_VERSION` to 3. Aggregation helpers — possession-weighted
ratings, minute-weighted PIE and usage, totals-based TS% — as pure tested
functions. Fix the `/ 100` display string in `FormulaPanel.tsx`.
*Gate: formula tests updated and green, including one pinning a known
season-to-date input to its expected `mvpValue` so a scaling slip fails loudly.*

**Phase 3 — compute the season.** For each of 164 dates, every player's
season-to-date, scored, written to `PlayerDailyValues`. Idempotent, re-runnable,
dry-run first.
*Gate: 95k rows, no `availability > 1`, no NaN, spot-check three dates by hand.*

**Phase 4 — serve and see it.** Add `?top=` to `/daily-mvp-rankings`; point the
front end at it. Swap the three VORP/WS/BPM cells in `PlayerProfileView` for
PIE / Net Rating / possessions.
*Gate: `VITE_DATA=api pnpm dev` renders the real season; screenshot the board,
a profile, and Harden's profile across his trade.*

**Phase 5 — buffer.** Regenerate `public/rankings.json` so a clone works with no
database. Update README numbers. Delete the obsolete Basketball Reference
scrapers and `scripts/generate-fixture.js` (a stale compiled duplicate of the
scoring pipeline).

Day 1: phases 1–2. Day 2: phase 3–4. Day 3: buffer and polish.

---

## Verification

1. `pnpm test` — currently 93 green; formula tests updated for v3.
2. Two-player proof runs as a test, not a script anyone has to remember.
3. Invariants over `PlayerDailyValues`: `availability ∈ (0,1]`,
   `gamesPlayed ≤ teamGamesPlayed`, `0.5·wc + 0.5·ts = rawValue`,
   `availability · rawValue = mvpValue`, no nulls, no NaN.
4. Sanity: the top 10 on the final date should be recognisable MVP candidates.
   If it isn't, something is wrong regardless of what the invariants say.
5. Cross-check against `DailyMvpRankings` — a different provider and a different
   formula, so exact agreement is not expected, but a wildly different top 5 on a
   shared date means an ingestion bug rather than a formula change.
6. Render it: rankings page, a profile, and Harden across the trade boundary.

---

## Step 0 — documents, before any code

These are the first actions on approval, not a later phase:

1. **`week-plan.md`** at the repo root — a copy of this plan, so it sits
   alongside the code and can be referenced while building.

2. **`README.md`** — update the formula block to
   `quality of impact = 0.4(PIE × 100) + 0.2(NR)` and
   `level of impact = (wins / games) × (MPG / 48) × USG`, then add a section
   showing the raw API response: the real Jokić row, the measured ranges across
   26,651 player-games, and the table of what is and is not transformed. The
   scaling rules are the most dangerous thing in this build and belong where
   someone reading the code will find them.

3. **`docs/ARCHITECTURE.md`** — same formula correction everywhere it appears,
   plus the per-game-extremes and zero-denominator findings.

**Status: step 0 complete.** All three documents are written. Note that
`README.md` had been deleted from the working tree at the time and was rebuilt
from scratch, so its pre-deletion state is not recoverable from git — the last
commit holds only the older Basketball Reference version.

---

## Risks

**Highest: the aggregation weights.** Possessions for ratings, minutes for PIE
and usage, shooting possessions for TS%. Using the wrong weight produces a
plausible leaderboard, and the per-game extremes above are what make the
difference large. Assert season-to-date ranges after aggregating.

*(Scale normalisation was the top risk until the constants were folded into the
formula. With nothing transformed at ingestion, there is no longer a step that
can be applied twice or skipped.)*

**Second: the traded-player denominator.** Verified for Harden; other trades may
have shapes his does not. Assert `gamesPlayed ≤ teamGamesPlayed` across all
582 players, not just the two tested.

**Not a risk any more:** API access. Verified working from plain `curl` with the
right headers; no Python needed at runtime.
