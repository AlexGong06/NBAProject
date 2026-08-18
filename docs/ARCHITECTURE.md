# Architecture: from daily snapshots to game events

**Status:** decided, not yet built. The application today still holds the daily
snapshot data described under "Before". This document is the record of what is
changing and why, so the reasoning survives the rewrite.

**Scope: the 2025-26 season, retroactively.** That season is complete — the last
game was 12 April 2026 — so every game is already on record and nothing is
arriving. The work is a one-shot reconstruction of a finished season, run on
demand and re-runnable, not a live collector.

Scheduling, incremental ingestion and anything that runs unattended are
explicitly **out of scope** and deferred until the next season starts. That
simplifies a great deal: there is no window to miss, no partial day to handle, no
job to supervise, and the whole pipeline can be rebuilt from scratch whenever the
formula changes.

---

## The change in one sentence

Stop photographing the league once a night and start recording every game, so
that rankings are *derived* from a complete event history rather than *sampled*
from whatever Basketball Reference happened to be showing at 4am.

---

## Before

A job ran once a day through the season. It read the top ~20 players by points
per game, opened each player's page and each team's page, copied the numbers it
found — including VORP, Win Shares and Box Plus/Minus, which Basketball Reference
computes — scored them, and wrote one row per player per day.

```
once a day ──► scrape top 20 PPG ──► score ──► one row per player, per day
                                                     │
                                        DailyMvpRankings (2,561 rows)
```

Everything that season produced is in those 2,561 rows, and everything it missed
is missing permanently.

That model has three faults, and they are the same fault seen from three angles.

**A failed night is gone forever.** 15 of 143 days in the 2025-26 season have no
data. The box-score half of those days can be reconstructed from game logs, but
VORP, Win Shares and BPM cannot: Basketball Reference publishes only a *current*
snapshot and overwrites yesterday's. Nobody can recover what those numbers were
on 12 February.

**Candidates are selected by points per game.** A player enters the tracked set
because he scores, not because the formula rates him. For a project whose entire
argument is that the obvious signal is a poor guide to who is playing best,
selecting candidates *by the obvious signal* is a contradiction sitting in the
middle of the product. A high-efficiency, high-defence, moderate-volume player
cannot appear no matter what the formula would say about him.

**The most important half of the score is borrowed.** `quality of impact` is
`0.4(VORP + WS) + 0.2(BPM)` — three numbers computed by somebody else. The
project's headline claim is about how it measures players, but the measuring is
largely outsourced.

---

## After

Ingest every game every player plays. Compute the advanced metrics from primary
box-score data. Score every player in the league after every game.

```
game logs (582 players)  ──┐
                           ├──► derived metrics ──► score ──► one row per player,
team logs (30 teams)     ──┘                                   per game played
                                                                     │
                                              PlayerGames · TeamGames · PlayerSeasonToDate
```

**Gaps become structurally impossible.** A game either happened or it did not,
and every game of a completed season is on record. There is no collector left to
fail, so there is nothing to miss. This is the difference between a system that
handles missing data well and a system that cannot have missing data.

**Every player is ranked.** ~582 instead of ~20. The candidate set stops being an
input to the ranking and becomes an output of it.

**Nothing is borrowed any more.** The quality term went from
`0.4(VORP + WS) + 0.2(BPM)` — three metrics Basketball Reference computes — to
`0.4(PIE × 100) + 0.2(NR)`, both supplied per game by the NBA's own API and both
measured from tracking data rather than inferred from a box score.

That is what makes per-date reconstruction possible at all. Win Shares needed
Dean Oliver's Points Produced and Defensive Rating; BPM needed a team adjustment
solving a whole roster jointly; PER needed league-wide pace as of the date. None
of them survive in the formula, so none of them need implementing, estimating or
holding constant.

---

## Side by side

| | Before | After |
|---|---|---|
| Unit of data | one player, one day the scraper ran | one player, one game he played |
| Who is ranked | top ~20 by points per game | all ~582 players in the league |
| Advanced stats | copied from Basketball Reference | computed from box scores |
| A missing day | permanent hole, displayed as a gap | cannot occur |
| "Rankings on 12 March" | a stored snapshot, or a 404 | a query over game history |
| Rows per season | ~2,500 | ~38,000 |
| Collection method | Playwright, 1 + 2N page loads | ~612 plain HTTP fetches, likely no browser |
| A player's chart | one point per calendar day | one point per game he played |
| Absence | invisible in the data | the most informative fact in an MVP case |

---

## What is given up

The current app has a genuinely distinctive feature: it shows you its own
collection failures. Dashed segments across gaps, hollow cells in the scrape
ribbon, a "no scrape ran" empty state, and a `404` rather than an empty array. It
refuses to interpolate, on the grounds that a straight line across a gap implies
continuity that was never measured.

**All of that disappears**, because there is nothing left to fail.

The honesty argument does not disappear with it; it moves. It goes from

> *we show you our gaps*

to

> *every number here was measured, per game, from the league's own tracking data —
> nothing is inferred, estimated, or copied from someone else's model*

which is a stronger claim, and one the data model enforces rather than merely
asserting.

---

## The aggregation rule

This is the most important thing in this document, and it is true of every data
source. **Advanced statistics cannot be averaged across games.**

Every advanced stat is a rate — a numerator over a denominator. Offensive rating
is points per 100 possessions. Usage is a share of team plays per minute on the
floor. True shooting is points per shooting possession. Averaging two games'
rates gives equal weight to a 12-minute blowout and a 44-minute overtime game,
which is simply the wrong answer.

The correct method is to recover the raw volume, sum it, and re-divide:

```
rolling rate = Σ(game rate × game denominator) / Σ(game denominator)
```

Each stat has its own denominator, and using the wrong one is a silent error:

| Stat | Weight by |
|---|---|
| Offensive / Defensive / Net Rating | **possessions** |
| Usage percentage | **minutes played** |
| True shooting | **FGA + 0.44 × FTA** |
| **PIE** | **minutes played** |
| Per-game box score averages | games played |

PIE deserves a note: it is a share of the game's total statistical events, so the
natural weight is the player's share of the game — minutes. Averaging a 38-minute
night against a six-minute one would let garbage time count equally.

A worked example, from the same reasoning: a player posts a 130 offensive rating
over 100 possessions in one game and 90 over 10 possessions in the next.
Averaging says 110. Weighting says `(130×100 + 90×10) / 110 = 126.4`. The second
game barely happened, and the arithmetic should say so.

**Consequence for storage.** Rows must carry the denominators, not just the
rates. A stored `netRating` with no `possessions` beside it cannot be aggregated
with anything — it is a dead end. This is why the event model stores raw
per-game facts and derives rolling values on read, rather than storing a rolling
value that cannot be recombined.

## Data source: moving to the NBA API

The project is moving from scraping Basketball Reference to the official NBA
stats API (the endpoints behind `nba.com/stats`, wrapped by
[swar/nba_api](https://github.com/swar/nba_api)).

**Why.** Basketball Reference publishes *estimates*. Its offensive and defensive
ratings come from Dean Oliver's box-score formulas, which infer possessions
rather than count them, and it has no on-court/off-court split at all — you
cannot know what a team did while a given player was resting. The NBA's own data
comes from arena tracking, includes real possession counts, and publishes
per-game advanced stats directly.

The relevant endpoints:

| Endpoint | Provides |
|---|---|
| `boxscoretraditionalv3` | per-game box score: PTS, FGA, FTA, AST, REB, BLK, STL, PF, TOV, minutes |
| `boxscoreadvancedv3` | per-game `offensiveRating`, `defensiveRating`, `netRating`, `usagePercentage`, `trueShootingPercentage`, and **`possessions`** |
| `playergamelogs` | games played, team context |

The `possessions` field is what makes the aggregation rule above executable: it
is the denominator, supplied per game, so rolling ratings become exact rather
than estimated.

### Verified: the endpoints answer, and what they return

Checked directly against the live API, not assumed.

**Access works.** An earlier draft of this document claimed the API refused this
machine and speculated about IP filtering. That was wrong. The request was
missing headers. `nba_api` sends a specific set, and once replayed exactly, a
plain `curl` returned 200 in 0.19s — so this is reachable from Node with no
Python at runtime.

The headers that matter, taken from `nba_api.stats.library.http.NBAStatsHTTP`:

```
Host: stats.nba.com
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.5
Accept-Encoding: gzip, deflate, br
Connection: keep-alive
Referer: https://www.nba.com/
Pragma: no-cache
Cache-Control: no-cache
Sec-Ch-Ua: "Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"
Sec-Ch-Ua-Mobile: ?0
Sec-Fetch-Dest: empty
```

Two traps worth recording. `Referer` must be `https://www.nba.com/`, not
`https://stats.nba.com/`. And the `x-nba-stats-origin` / `x-nba-stats-token`
headers that circulate widely in blog posts are **not** sent by `nba_api` — 
including them and omitting the `Sec-*` headers is what produced the original
failure. When the API declines it does not return 403; it accepts the connection
and never replies, so a wrong header set looks exactly like a network outage.

**`boxscoreadvancedv3` returns, per player per game:**

```
minutes                      possessions          PIE
offensiveRating              defensiveRating      netRating
usagePercentage              trueShootingPercentage
effectiveFieldGoalPercentage assistPercentage     assistToTurnover
offensiveReboundPercentage   defensiveReboundPercentage
reboundPercentage            turnoverRatio        assistRatio
pace                         pacePer40
```

`possessions` is the field that makes the aggregation rule above executable — the
per-game denominator, supplied rather than estimated. This is the single largest
advantage over Basketball Reference, whose ratings are inferred from box scores
via Dean Oliver's formulas.

**Scale differs from Basketball Reference, and this will bite.** The NBA API
returns rates as fractions where Basketball Reference returns percentages:

| Field | NBA API | Basketball Reference |
|---|---|---|
| `usagePercentage` | `0.208` | `20.8` |
| `trueShootingPercentage` | `0.925` | `.925` |

The scoring formula divides usage by 100. Fed an NBA API value unchanged, it
would be wrong by a factor of 100 and still produce a plausible-looking
leaderboard. Normalise at the ingestion boundary, once, and assert the range in a
test.

### `nba_api` is a reference, not a runtime dependency

The package is Python and has no official Node version. But it is a wrapper over
plain HTTP, and the probe above proves those endpoints answer a bare `curl` given
the right headers — so **no Python service is required at runtime.**

Its value is as documentation: the header set, the endpoint names, the parameter
shapes, and the response envelope, none of which NBA publishes. Read the package
to learn those, implement the two or three endpoints actually needed in
TypeScript, and keep `scripts/nba-api-probe.py` as a way to check the API
directly when a response looks wrong.

### Resolved: PIE replaces VORP and PER

VORP and PER are not NBA statistics — VORP is a Basketball Reference construct
and PER is Hollinger's. Rather than keep a second data source alive to supply
two borrowed metrics, the formula's quality term now uses NBA's own impact
metric:

```
quality of impact = 0.4(PIE × 100) + 0.2(NR)
level of impact   = (wins / games) × (MPG / 48) × USG
```

**What this removes.** A derived BPM and the minutes-weighting behind it. A
season-constant PER and the `perSource` field tracking it. Basketball Reference
as a data source at all. Every input now comes from one API, measured per game.

**Scale, and this is the trap.** PIE is returned as a fraction. Measured across
the 367 players with 40+ games in 2025-26:

| | min | median | max |
|---|---|---|---|
| `PIE` | 0.027 | 0.092 | **0.213** |
| `NET_RATING` | −16.1 | −0.1 | **17.6** |

Substituted raw, `0.4 × 0.213 = 0.085` sits against `0.2 × 10.8 = 2.16`. The term
intended to carry the score would carry **under 4%** of it, and the formula would
collapse into Net Rating with a rounding error attached. The previous
`VORP + PER` term carried about 88%.

**PIE is therefore scaled by 100 inside the formula** — `0.4(PIE × 100)`, which
puts the term back at roughly 80%.

The scaling lives in the formula rather than at the ingestion boundary, and that
placement is deliberate. Usage has the mirror-image problem: the old formula wrote
`usageFactor = usageRate / 100` because Basketball Reference gave `28.8`, while
the NBA API gives `0.288` — already the factor. Normalising usage up at ingestion
and dividing it down in the formula would be two transformations that cancel, so
both disappear:

```
usageFactor       = USG_PCT                       (was usageRate / 100)
quality of impact = 0.4(PIE × 100) + 0.2(NR)
```

**The result is that nothing is transformed at ingestion.** Stored values are
byte-identical to the API response, so they can be diffed against the source at
any time, and there is no normalisation step that could be applied twice or
skipped — which was the single largest risk in this design.

Writing the PIE term as `40 × PIE` would be arithmetically identical — verified
on Jokić's season figures, both give `8.560000` — but it would hide the
0.4-to-0.2 weighting and make a future retune to 0.5 mean writing `50`. The
weights stay legible.

Two consequences: ranges are asserted **after** aggregation, since per-game
inputs are legitimately out of range and season-to-date values are not; and
`FormulaPanel.tsx`, which renders `(${usageRate.toFixed(1)} / 100)` to show users
the working, would display `0.3 / 100` unless updated.

### Per-game values are extreme, and two denominators can be zero

Measured across all 26,651 player-games of 2025-26:

```
PIE          min  -11.000   median  0.090   max   6.000
NET_RATING   min -400.000   median  0.000   max 300.000
USG_PCT      min    0.000   median  0.177   max   1.000
TS_PCT       min    0.000   median  0.560   max   1.500
POSS         min    0.000   median 49.000   max 122.000
MIN          min    0.000   median 23.400   max  52.300
```

A single-game PIE of `6.0`, or a net rating of `−400`, is genuine — a two-minute
garbage-time appearance where the denominator is almost nothing. Weighted across
a season these collapse to sane values, season PIE topping out around `0.213`,
which is the concrete argument for the aggregation rule over averaging.

**`POSS = 0` and `MIN = 0` rows exist**, and both are weights. A zero total
produces `NaN` or `Infinity` that propagates into `mvpValue` and then sorts
unpredictably. Drop zero-minute appearances at ingestion and guard the totals
anyway.

**What this costs.** PIE is a rate: a share of the game's statistical events. It
does not accumulate. VORP did, so a player who sat stopped gaining it, and
absence was penalised twice — once by availability and once by a frozen VORP.
Under PIE the availability multiplier is the *only* term that notices absence at
all. That makes it load-bearing rather than reinforcing, and worth watching when
the first rebuilt leaderboards appear.

## Appendix: what Basketball Reference publishes

**Superseded.** Kept for reference only — the rebuild takes nothing from
Basketball Reference. It remains useful for two things: cross-checking a number
that looks wrong, and reading the existing `DailyMvpRankings` rows, which were
collected from here.

Surveyed directly, all reachable with a plain HTTP fetch and no browser. Table
ids matter — several pages carry a regular-season table and a playoff table with
near-identical markup, and the playoff one restarts its counters.

### Per player

| Page | Table id | Granularity | Carries |
|---|---|---|---|
| `/players/{i}/{id}.html` | `{id}`, rows `advanced.{season}` | **one row per season** | **PER**, TS%, USG%, OWS, DWS, WS, OBPM, DBPM, BPM, VORP |
| `/players/{i}/{id}/gamelog/{season}/` | `player_game_log_reg` | **per game** | full box score, `ranker` (games-played counter), `game_result`, `team_game_num_season` |
| `/players/{i}/{id}/gamelog-advanced/{season}/` | `player_game_log_adv_reg` | **per game** | `usg_pct`, `bpm`, `off_rtg`, `def_rtg`, `ts_pct`, `efg_pct`, `orb_pct`, `drb_pct`, `trb_pct`, `ast_pct`, `stl_pct`, `blk_pct`, `tov_pct`, `game_score` |
| `/players/{i}/{id}/splits/{season}/` | `splits` | situational | monthly and situational splits — not daily |

The `-advanced` suffix pattern is consistent: append it to the game-log path.

### Per team

| Page | Granularity | Carries |
|---|---|---|
| `/teams/{TM}/{season}/gamelog/` | per game | team **and opponent** box totals, `overtimes` |
| `/teams/{TM}/{season}/gamelog-advanced/` | per game | `pace`, `team_off_rtg`, `team_def_rtg`, `ts_pct`, `efg_pct`, `orb_pct`, `tov_pct`, `ft_rate` + opponent equivalents |
| `/teams/{TM}/{season}.html` | season | record — **but inside an HTML comment**, revealed only by the site's own JavaScript, which is the sole reason a browser is needed today |

### League-wide

| Page | Rows | Carries |
|---|---|---|
| `/leagues/NBA_{season}_per_game.html` | 582 players | box-score rates, games, GS, pos, age, team |
| `/leagues/NBA_{season}_advanced.html` | 582 players | **PER**, TS%, USG%, WS, BPM, VORP |
| `/leagues/NBA_{season}_per_poss.html` | 582 players | per-100 rates plus **`off_rtg`, `def_rtg` per player** |
| `/leagues/NBA_{season}_standings.html` | 30 teams | records, not commented |

League tables join to player pages on `data-append-csv`, Basketball Reference's
player id — a real key, unlike a display name. All league tables are a **current
snapshot only**; they cannot describe a past date.

## The scoring inputs, and where each comes from

`quality of impact` is `0.4(PIE × 100) + 0.2(NR)`, where `NR = ORtg − DRtg`.

| Input | Source | Per game? |
|---|---|---|
| PIE | `boxscoreadvancedv3` | yes — scale to a percentage |
| Net Rating | `boxscoreadvancedv3`, `offensiveRating` − `defensiveRating` | yes |
| USG%, TS% | `boxscoreadvancedv3` | yes — fractions, scale them |
| possessions | `boxscoreadvancedv3` | yes — the aggregation denominator |
| PTS, AST, REB, BLK, STL, PF, TOV, minutes | `boxscoretraditionalv3` | yes |
| games played, team wins | `leaguegamefinder` | whole season available |

Every one of these is measured per game and aggregates by the rule above. There
is nothing left in the formula that has to be estimated, held constant, or taken
from a second source — which is the substantive difference from every earlier
version of this design.

## Players who change teams

A player traded mid-season breaks the assumption that "his team" is one thing,
and the formula depends on it twice: `wins / games` inside level of impact, and
`availability = gamesPlayed / teamGamesPlayed`.

His games accumulate across both clubs, while either club's record alone is the
wrong denominator. Using the *current* club's full-season record can produce
`availability > 1` — a failure this project has already had, on 137 rows.

**Accumulate stint-weighted.** For each stint the player spent at a club, count
that club's games and wins during the stint only, then sum across stints. That
makes `gamesPlayed ≤ teamGamesPlayed` true by construction.

Three separate concerns, and conflating them is how the current scraper ended up
with a `"2TM"` hack that searches the whole document for a stray team cell:

1. **Identity** — the Basketball Reference player id never changes. All
   accumulation is by id, across clubs.
2. **Denominator** — stint-weighted, as above.
3. **Display** — the club from the most recent game, plus a list of clubs seen.

Verified against the 28 cached logs: `teamGamesToDate` is monotonic for every
player, so there is no ordering bug — but James Harden's log **skips team games
50 and 51**, the trade boundary. Whether a new club's log includes games from
before the trade determines how stint boundaries are detected, and it must be
checked against a real traded player before the ingest is written.

## Data model

Three collections. The split between them is the load-bearing decision.

### `PlayerGames` — immutable fact

One row per player per team game on their log, including games they missed. The
log lists every team game, which is what makes it an independent record of the
team's season as well as the player's.

`_id` is deterministic (`"jokicni01:202603120DEN"`), so ingestion is idempotent
and re-running it cannot duplicate anything.

### `TeamGames` — immutable fact

One row per team per game, carrying team **and opponent** totals plus overtimes.
That is everything Dean Oliver's possession estimate needs, and it is also where
team wins and losses come from — which is why Playwright can probably be dropped
from the project entirely. The only reason a browser is required today is that
the team page hides its record inside an HTML comment that Basketball
Reference's own JavaScript reveals at runtime.

### `PlayerSeasonToDate` — derived

One row per player per game *played*, holding season-to-date figures after that
game, the three advanced metrics, and the score.

**Why the facts and the derivations are separate collections:** facts are written
once and never change. Derived values are rewritten every time the formula or the
metric implementation changes. Merge them and a single bad migration destroys the
irreplaceable half along with the replaceable half.

Rows carry both a `formulaVersion` and a separate `computeVersion`. The scoring
formula and the metric implementation change on different schedules, and
conflating them produces an unexplainable discontinuity in a time series whose
whole point is comparability.

### Two key changes

**`playerId`, not player name.** Names collide, change, and carry accents. The
Basketball Reference id (`jokicni01`) is a real key; a display name is not.

**ISO dates in the new collections.** `src/utils/date-key.ts` documents that
`"M-D-YYYY"` cannot be sorted as text — which is why both API routes currently
sort in Node rather than in Mongo. Harmless across 128 dates; fatal when date is
the primary index over 38,000 rows. `M-D-YYYY` survives only as a URL and display
format, converted at the API boundary.

---

## Serving the leaderboard

`GET /daily-mvp-rankings` currently returns the entire collection — 2.2 MB today,
roughly 40 MB at 38,000 rows. That endpoint does not survive.

Four narrow endpoints replace it:

```
GET /calendar?season=2026        league game days + game counts    ~8 KB
GET /leaderboard/:date?top=30    one precomputed document         ~27 KB
GET /players/:id/history         {date, rank, mvpValue}[]          ~5 KB
GET /players/:id                 latest row + breakdown + games
```

Leaderboards are precomputed (~170 documents per season) rather than aggregated
per request. The equivalent live aggregation stays available behind `?live=1`,
with a test asserting the two agree — the structural guard against a precomputed
view silently drifting from its source.

A cold page load goes from 2.2 MB to roughly 40 KB.

---

## What happens to the existing 2,561 rows

They are kept, stripped, and renamed to `PublishedAdvancedSnapshots`.

They are the only surviving record of what Basketball Reference's advanced
metrics were on 128 specific dates. Basketball Reference will never again publish
what those values were mid-season, so nothing can regenerate them.

Their role has changed with the formula. They no longer validate anything in the
score — VORP, Win Shares, BPM and PER are all out of it, so there is nothing left
to check them against. What they still provide is a **second, independent
measurement of the same season** from a different provider, on 128 dates.

That makes them useful in one specific way: when the rebuilt leaderboard
disagrees violently with the old one on a given date, these rows say whether the
disagreement is the formula change or an ingestion bug. Two sources that were
never meant to agree exactly, but should not diverge wildly, is a cheap sanity
check on a pipeline nobody has run before.

They are also simply irreplaceable — Basketball Reference overwrites its
mid-season values, so no future effort can recover them. Keeping them costs a few
megabytes.

But two collections that can both answer *"who was #1 on 12 March"* is exactly how
a leaderboard ends up disagreeing with itself. So `mvpValue`, `calculatedRank`
and every breakdown term are **stripped**, leaving the collection physically
incapable of answering the ranking question. What remains is the measurement:
`{date, playerId, gamesPlayed, teamGamesPlayed, vorp, ws, bpm, usg, ts}`.

Read-only. No route. Two jobs: regression fixture for the metric implementation,
and eventually an "ours versus Basketball Reference" overlay in the UI — which is
squarely on-thesis for a project about not taking a published number on trust.

---

## Front end

The daily-snapshot assumption is almost entirely quarantined in
`src/front-end/src/data/build-source.ts`. Components speak only to the
`DataSource` interface, so the blast radius is smaller than it looks.

The highest-leverage change: **`DATES` stops meaning "every calendar day" and
starts meaning "the league game calendar"** (~170 days). `charts.ts` assumes
consecutive array indices are consecutive points; under a game calendar that
assumption becomes *true again*, and the index-uniform x-axis stops lying without
touching any geometry code.

`MISSING`, `previousWithData` and `nearestWithData` are deleted — the concept no
longer exists. `missing` becomes `didNotPlay`, renamed so the old meaning cannot
be read back in: absence stops being a defect in the data and becomes the most
informative single fact about an MVP case.

`history()` gains a basis, and this is the crux of the front-end work:

```ts
history(playerId, dateKey, window, basis: "games" | "gamedays")
```

A player appears roughly three nights in seven. `"games"` returns one point per
game he played and never returns a null, which is what the profile charts want.
`"gamedays"` returns one point per league game day with the season-to-date value
carried forward on rest nights, which the bump chart needs because five players
must share one x-axis. Getting this distinction wrong renders every chart as
confetti.

The scrape ribbon is **repurposed rather than deleted** — same strip, one cell per
game day, filled when the player played and hollow when he rested. It becomes an
availability strip, giving a multiplicative term in the formula its first
visualisation.

---

## Not a multi-sport refactor

The long-term intent is that a fan can track an MVP race in any sport they
follow. That does **not** mean building a sport abstraction now.

NFL, soccer and anything else will be **separate applications**, each with its own
ingestion, its own logic, and its own formula. A sport interface designed before a
second sport exists would be shaped entirely around basketball assumptions, and
the second sport would spend its life fighting it.

The goal for this codebase is to be clean enough to **copy**, not generic enough
to **configure**. Shared abstractions get revisited once there are two real
implementations to compare, not one real and one imagined.

---

## Sequencing

Nothing touches `DailyMvpRankings` until the cutover, and the application keeps
working throughout. Because the season is complete, every phase is a batch job
that can be re-run from scratch — there is no live pipeline to keep alive while
rebuilding underneath it.

| Phase | Work | Risk |
|---|---|---|
| 0 | Decide the VORP/PER question; normalise NBA API scales | none |
| 1 | Ingest the full 2025-26 season: player and team box scores | low |
| 2 | Derive rolling rates by the aggregation rule | low |
| 3 | Compute and store per-game scores and leaderboards | low-medium |
| 4 | New API routes, purely additive | low |
| 5 | Front end behind a flag | medium |
| 6 | Cut over, retire the old collection | low |
| 7 | Deploy | low |

**Phase 0 is now a decision, not plumbing.** The formula needs VORP and PER; the
NBA API supplies neither. That has to be settled before ingestion, because it
determines whether Basketball Reference stays in the picture as a second source.

Deployment blockers and CI have moved out of the sequence entirely — there is no
scheduled job to protect, so the API only needs to run when someone is looking at
it.

**Phase 2 used to be the riskiest thing in this plan and no longer is.** Under
the old formula it meant implementing Win Shares and BPM 2.0 from published
methodology — a chain of five formulas, including a team adjustment that solves a
whole roster jointly, where an error anywhere produces numbers that still look
entirely plausible. Days of work with a real chance of failure.

Replacing Win Shares and BPM with PER and Net Rating collapsed it to reading two
columns and one line of arithmetic, already verified. The risk moved from
"can this be implemented correctly" to "is the ingest complete", which is
checkable rather than subtle.

**The new riskiest phase is 5**, the front end — specifically the two-basis
`history()`, where a wrong answer renders as a plausible chart rather than an
error.

Rows carry a `computeVersion` alongside `formulaVersion`, pinning the ingestion
and aggregation logic separately from the scoring weights. They change on
different schedules, and a leaderboard that shifted for an unrecorded reason is
the one failure this project has repeatedly had to dig itself out of.

There is no longer a `perSource` field, and nothing needs one: every input is
measured per game from a single API. That field existed to mark a PER held
constant, and PER is gone.

Since the season is finished, every one of these phases is idempotent by
construction: the inputs never change, so any phase can be re-run and must
produce the same output. That is worth asserting in a test rather than assuming.

## Next season

Out of scope here, and worth writing down only so it is not forgotten. When the
2026-27 season starts, the pipeline needs a way to pick up new games — but the
event model makes that a much smaller problem than the old daily snapshot was.
Ingest is "fetch games since the last one stored", and a missed day costs
nothing, because the games are still there tomorrow.

Nothing in this document should be designed around that. Reconstructing one
finished season correctly is the whole job for now.
