# Rebuild the MVP tracker on the NBA API — by Thursday

## Context

*Written before the rebuild, in the present tense of the time. Phases 1–7 below
are complete; this paragraph describes what the project used to be.*

The tracker scraped Basketball Reference once a night for the top ~20 scorers
and copied their advanced metrics. Three problems: 15 days were lost permanently
when the scraper failed, candidates were selected by points per game (the exact
signal the project argues is misleading), and the most important half of the
score was somebody else's arithmetic.

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

**Status: phases 1–5 complete.** The season is reconstructed, 83,054 rows sit in
`PlayerDailyValues`, and all 582 players are searchable across 164 dates. The
work below is what came after: the pipeline is right, and the front end is what
is now wrong.

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

## Phase 6 — the profile page

Shipping phases 1–5 made every player reachable, which immediately exposed that
the profile page was never built for more than the top twenty. Three items,
two of which turned out to be the same bug.

### The root cause: the board is not the league

`build-source.ts` builds `PLAYERS` from any row that ever appeared in the loaded
top-50 board, and `findPlayer` treated membership in that list as *"we hold this
player's season"*. That is false. The board is a top N per date; a season is 164
dates deep and ranked against all 582.

**Gary Payton II reached the top 50 exactly once in 164 dates** — on
**2025-10-21, opening night**, off a single game. That is the early-season
volatility this project treats as a feature, and it is exactly the case the
board mishandles. That one row became his entire identity in the app.

Measured against the live database, his October 21 row is
`#20 · mvp 0.298 · 1/1 games · 1–0 · 12.1 MPG` — every figure in the reported
screenshot, four months stale:

| Symptom | Cause |
|---|---|
| "RANK TODAY #20" in April | `p.calculatedRank` from his opening-night row — a position within 50 loaded rows, not a league rank |
| `1–0 · 1/1 games · 12.1 MPG` | same stale row |
| An empty rank chart | `history()` deferred to the board for anyone in it, giving one point and 163 nulls |
| Field position showing strangers | the rail rendered the *last* date's top 50, which he is not in |

`loadPlayerSeason` never fetched his season, because `findPlayer` hit first.

His true standing, from the new endpoint: **#199 of 582 on 2026-04-12** with
73/82 games. On 2025-11-16 — the date the screenshot's chart window ended — he
was #265 of 466. At no point after opening night was he anywhere near #20.

### What changed

**1. Player headshots.** `https://cdn.nba.com/headshots/nba/latest/260x190/{playerId}.png`
— verified live, 200, ~15 KB. No new fetch, no download, no storage: the id is
already in every row. The API projects `playerId`; the fixture drops it but
keeps `profileUrl`, whose path embeds the same id, so `data/headshot.ts` reads
whichever is present and headshots work offline too. A new `<Headshot>` in
`ui.tsx` layers the image over the existing initials and falls back to them on
error — players with no CDN photo show "GP", never a broken image. Wired into
all four avatars: profile (132px), rankings hero (104px) and rows (52px), search
(36px).

**2. The profile is now a function of a date, not of "today".**

- `loadPlayerSeason` no longer short-circuits on board membership. The season
  endpoint wins whenever the source has one; the board is the fallback, not the
  shortcut. This one change fixes the header, the chart and the peak.
- `history()` prefers a fetched season outright.
- New `rowFor(player, dateKey)` — every number on the page reads the row for the
  selected date.
- New `fieldAround(player, dateKey, window)`, backed by a new
  `GET /daily-mvp-rankings/:date?around=<player>&window=N`. It returns the
  player's true rank, the size of the field it was measured against, and his
  neighbours — all three together, because a rank without its field size is
  exactly the confusion being fixed. Ranks use the same
  `countDocuments({ mvpValue: { $gt } }) + 1` definition as the per-player
  season endpoint, so the two cannot disagree.
- The header now reads **"Rank on Nov 16"** with **"of 582 players"** beneath
  it. In fixture mode it says "of 25 loaded" instead — `FieldWindow.complete` is
  what keeps a rank out of 25 from being read as a rank out of 582.
- A date picker on the profile: prev/next chevrons, the date spelled out, and
  the same `ScrapeRibbon` the rankings page uses.
- The selected date moved out of React state and into the URL as `?date=`. Both
  views are a function of a date; holding it in memory meant a profile could not
  be linked to as it was being read, and that moving between board and profile
  silently changed the day.

**3. The chart follows the player.** `rankDomain()` is extracted and now takes
every series being plotted, so the axis frames whatever is on screen. Field mode
was the broken one — it drew the top 5 of the last date on a hardcoded #1–#8
axis, which on a #300 player's profile is five strangers above an empty chart.
It now plots him and his two nearest rivals either side, and their seasons are
fetched only when field mode is actually selected.

### Where phase 6 stands

*Phase 6 is committed and shipped. Headshots were confirmed painting in a real
browser; the sandbox that ran the checks could not reach `cdn.nba.com`.*

**Done, and typechecking clean on both the front end and the backend:**

| Area | Files |
|---|---|
| Headshots | `data/headshot.ts` (new), `components/ui.tsx`, and the four avatar sites |
| The `around` endpoint | `api/routes/daily-mvp-rankings.ts` |
| The board/season fix | `data/build-source.ts`, `data/types.ts`, `data/api.ts` |
| Date-scoped profile | `components/PlayerProfileView.tsx` |
| Date in the URL | `App.tsx` |
| Chart domain + field mode | `charts.ts` |

**Tests: 160 passing, up from 142.** Eighteen new, of which the ones that matter
are a `describe("a player the board saw on only one date")` block reproducing
the Gary Payton II shape directly — a player in the board on one date, with a
full season behind him — and asserting each symptom above is gone.

One existing test had to be **inverted rather than fixed**: it asserted
*"answers from memory for a player already on the board — no request for someone
we already hold"*. That assumption is the bug. It now asserts the opposite, with
a comment saying why, so nobody reinstates the optimisation.

**Verified by driving the real app** against the live database — a headless
browser on the API source, then again on the fixture. This codebase produces
plausible wrong answers and `#20` looked plausible for months, so the suite was
never going to be the gate.

| Check | Result |
|---|---|
| GPII on 2026-04-12 | **#199 of 582**, 73/82 games, 15.7 MPG — was #20, 1/1 games |
| Scrub to 2025-10-21 | **#20 of 40 players** — correct, and only there |
| Rank chart | continuous line, axis #195–#211, gap dashed — was an empty #1–#8 grid |
| Field position | 21 rows, #189–#209, GPII highlighted at #199 |
| Field mode | 5 lines, axis #134–#238, his rivals — not Jokić |
| Jokić | #2 of 582, value 1.385, axis still #1–#8 — unchanged |
| Fixture mode | renders with no database, says "#2 **of 25 loaded**" |
| Fixture, no row for the date | stats omitted, not stale — see the defect below |
| Console | no application errors in either mode |

Two defects were found by looking rather than by testing, and both are fixed:

1. **Field-mode end labels collided.** Neighbours converge by definition, so
   their team abbreviations printed on top of each other at the right edge —
   unreadable exactly where the comparison matters. The old top-5 view never hit
   this because ranks 1–5 are far apart. Labels are now pushed apart to an 11px
   minimum.
2. **Stale stats leaked on a date with no row.** The header correctly said "no
   game data by this date" while the meta line below it still printed
   `1–0 · 1/1 games · 12.1 MPG` from the identifying row — the same
   say-one-thing-show-another failure being fixed, in miniature. Every stat block
   is now gated on the date's row; only name, team, position and age survive
   without one.

**Not verified: that a headshot actually paints.** The sandboxed browser cannot
reach `cdn.nba.com` at all (`chrome-error`), though `curl` fetches the same URLs
fine. What *is* verified: the id is derived correctly from both sources (the API's
`playerId` and the fixture's `profileUrl` — the browser requested
`260x190/203999.png` for Jokić in fixture mode, which has no `playerId` at all),
the URL returns a real 14.8 KB PNG under `curl`, and the fallback works — every
one of ~80 blocked requests degraded to initials with no broken image and no
layout shift. **Confirm the photos in a normal browser.**

### Deliberately not done

- **The formula is untouched.** No recompute, no rebuild, no migration — every
  number already exists in `PlayerDailyValues`.
- **No rank is stored**, still. The fix was to ask the right question on read,
  not to cache the answer.
### The rank query was rewritten, after measuring

Left alone at first, on the rule that an unmeasured optimisation is a guess. It
was then measured, and it was slow — every profile now fetches a season, where
before only the ~445 players outside the board did.

`players.ts` was doing one `countDocuments` per date: correct and index-only,
but 164 round trips. Field mode makes it worse, asking for five players at once
through one connection pool.

| | 164 counts | one aggregation |
|---|---|---|
| One season | 1.7–2.0s | **0.75s** |
| Five at once (field mode) | 8.10s | **2.06s** |

The replacement groups with `$sum` and never `$push` — the 100 MB limit that
rules out aggregation elsewhere in this collection is hit by materialising
documents, not by scanning them, so counting stays well inside it.

**Verified equivalent, not just faster.** Ranks were captured from the old
implementation for Jokić, Gary Payton II, Shai Gilgeous-Alexander, Harden and
Wembanyama, then compared row by row against the new one: 816 date-rows,
identical throughout. A faster ranking that ranks differently would be worse
than the slow one.

---

## Phase 7 — front-end cleanup: the collector is gone

Cleanup before the next round of features. Nearly all of it traces to one fact
the front end never absorbed after phases 1–5: **there is no collector.** The
season is rebuilt retroactively from the NBA stats API in a single pass. Nothing
runs nightly, and no day's data ever "failed to arrive".

### The ten gaps were never gaps

The calendar days between Oct 21 and Apr 12 that carry no rows, measured from
the committed fixture:

| Date | What it is |
|---|---|
| Thu 2025-11-27 | Thanksgiving |
| Tue 2025-12-16 | NBA Cup final — no regular-season games |
| Wed 2025-12-24 | Christmas Eve |
| Fri 2026-02-13 → Wed 2026-02-18 | All-Star break |
| Sat 2026-04-11 | day before the finale |

Every one is a scheduled NBA off day. `src/api/routes/daily-mvp-rankings.ts`
already named these four cases in a comment; the UI called them `no scrape`,
`The collector did not run on this date`, and showed a warning-icon page reading
`GET /daily-mvp-rankings/2-13-2026 → 404` **instead of a leaderboard**.

That last part was the real cost. On six days of the All-Star break the app
showed no standings at all, when the truthful answer is that the standings are
Feb 12's, unchanged, because nobody played.

### What changed

**Off days now inherit.** `build-source.ts` gained one concept —
`effectiveDate(dateKey)`, the game day whose standings are in effect — and
everything date-scoped routes through it: the new `standingsFor` (which the
board reads), `rowFor`, and `fieldAround`. That last one matters most: the API
correctly 404s for an off day, so the profile had to resolve the date *before*
the request rather than interpret the 404 after it.

**Charts run flat instead of breaking.** `projectHistory` carries the last
observed value across off days, so `rankGeometry` sees no gap. The dashed
connectors, the shaded bands and the `no scrape` label are deleted. Verified
mid-break: Jokić on Feb 16 renders one polyline, zero dashed gaps, zero shaded
bands — reading `#2 of 532 · 1.261 · 39/55 games`, which matches this document's
own pre-build checkpoint for him exactly.

`HistoryPoint` now separates two things `missing` conflated: `noGames` belongs to
the date, a null rank on a *game* day belongs to the player (he had not debuted).
Only the first is carried — there is a test for a rookie to keep it that way.

**Race to #1 had three defects, all the same shape as phase 6's.**

1. It drew outside its own card. `rankGeometry` was called with a hardcoded max
   rank of 8, so a player at #12 mapped to y=230 in a 176-tall box. Now uses the
   `rankDomain` written in phase 6. Measured after the fix: every point between
   y=14 and y=110, inside a 176 box.
2. It plotted the **wrong five players** — the cast came from `TODAY_KEY`, the
   season-final leaders, while the lines were drawn over the selected date. On
   Jan 20 it charted SAS and BOS above a board listing DET and PHI. Now reads the
   selected date; verified the five `<title>`s match the five rows beneath.
3. It labelled teams. Each line was already a player; only the label was a team
   abbreviation. They are ringed headshots now, initials underneath so a missing
   photo still resolves.

A de-collision bug was found by measuring rather than looking: the per-face
clamp that kept circles inside the band silently undid the spacing pass, leaving
rank 1 and rank 2 thirteen pixels apart when they need twenty-four. Fixed by
shifting the column as a unit.

**The Collector card is deleted.** Source `basketball-reference`, a hardcoded
`06:12 ET` run time, `Last run: failed` (a misread of `snap.missing`), and
`Gaps in window`. Every row was fiction. Nothing replaces it.

**Renames**, so the code stops describing a collector that does not exist:
`ScrapeRibbon` → `SeasonRibbon`, `D.MISSING` → `D.NO_GAME_DAYS`,
`Snapshot.missing`/`HistoryPoint.missing` → `noGames`, `nearestWithData` →
`nearestGameDays`. The ribbon also lost an `i > 24` shading rule that meant
"within the last 30 days" when the strip was 30 cells long and, across 174, only
made the first three weeks look different for no recoverable reason.
`src/services/scraper/` is dead code and was deliberately left for its own
change.

`grep -riE "scrape|collector|basketball.reference" src/front-end/src` now
returns only comments recording what things used to be.

### Verification

168 tests green, up from 160. Driven in a browser on spare ports against the
live database: the All-Star break renders a real board under a *"No NBA games …
standings unchanged since Feb 12"* banner with nearest-game-day buttons; Jan 20's
rail chart stays in its box with the right five faces; fixture mode still runs
with no database at all.

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
