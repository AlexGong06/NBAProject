# Architecture

A guide to where things live and why they work the way they do. For the formula
itself and what the NBA API returns, see [README.md](../README.md).

## What this is

The 2025-26 NBA season, reconstructed from the league's own stats API, scored by
a custom MVP formula on every date, stored in MongoDB Atlas and served to a React
app.

The season is **complete and finished**. Nothing new arrives, there is no
scheduled job, and no collector. The whole season is computed retroactively and
can be rebuilt from scratch in about three minutes. That single fact explains
most of the design: there is no window to miss, no partial day to handle, and a
formula change is a recompute rather than a re-fetch.

```
stats.nba.com ──► PlayerGameLogs2526 ──► rolling aggregation ──► PlayerDailyValues
   (5 calls)        (raw, immutable)      (the formula)           (83,054 rows)
                                                                        │
                                                            Express API ─┴─► React app
```

## Feature → where it lives

| Feature | Files |
|---|---|
| The leaderboard | `RankingsView.tsx` · `standingsFor` in `build-source.ts` · `GET /daily-mvp-rankings/:date` |
| A player's profile | `PlayerProfileView.tsx` · `loadPlayerSeason` · `GET /players/:name/daily-mvp-rankings` |
| Rank charts | `charts.ts` · `projectHistory` in `build-source.ts` · `GET /calendar/series` |
| The season ribbon / date picker | `SeasonRibbon.tsx` · `GET /calendar` |
| Last-game chip on a row | `LastGameChip.tsx` · `last-game-index.ts` · `GET /games/last` |
| The game view + box score | `GameView.tsx` · `GET /games/:gameId` · `GameSummaries2526` |
| Highlight reels | `resolve-highlights.ts` · `highlight-title.ts` · `PlayerGameHighlights` |
| Player search | `SearchOverlay.tsx` |
| The formula panel | `FormulaPanel.tsx` · `mvp-formula.ts` |
| Off days | `effectiveDate` / `standingsFor` in `build-source.ts` |
| Mobile layout | `use-media-query.ts`, branched at ~20 sites in the view components |
| Images (headshots, logos, posters) | `headshot.ts` · `team-logo.ts` · `video-thumbnail.ts` |

Nothing in the front end computes a score. Every number on screen was calculated
once by the backend and stored; the UI reads and ranks.

## The data model

Four collections. The split between raw fact and derived value is the
load-bearing decision: facts are written once and never change, derived values
are rewritten whenever the formula does. Merging them would mean one bad
migration destroys the irreplaceable half along with the replaceable half.

| Collection | Rows | Authoritative for | `_id` |
|---|---|---|---|
| `PlayerGameLogs2526` | 26,638 | raw per-player-per-game facts, byte-identical to the API | `playerId:gameId` |
| `PlayerDailyValues` | 83,054 | season-to-date inputs, every formula term, `mvpValue` | `playerId:isoDate` |
| `GameSummaries2526` | 1,230 | quarter scores, final score, home side, `neutralSite` | game id |
| `PlayerGameHighlights` | 1,230 | game → YouTube video id | game id |

`DailyMvpRankings` and `DailyStatsLeaders` are legacy, superseded, and safe to
drop with `pnpm cleanup`.

## The API

Express on port 3000, CORS allowlisted via `CORS_ORIGIN`.

| Route | Returns |
|---|---|
| `GET /health` | `{ok:true}` — process liveness, touches no database |
| `GET /daily-mvp-rankings/:date` | one date's board, `?top=` capped at 100, `?around=` for a player's neighbours |
| `GET /players/:name/daily-mvp-rankings` | one player's season |
| `GET /games/last` | the last-game index |
| `GET /games/:gameId` | one game: summary, box score, highlight |
| `GET /calendar` | the league's game days |
| `GET /calendar/series` | rank and value per player per date, compact keys |

## Decisions worth knowing

**Advanced statistics are never averaged across games.** Every one is a rate.
Averaging two games' rates weights a 12-minute blowout the same as a 44-minute
overtime game. The correct method recovers the raw volume, sums it, and
re-divides — `Σ(rate × denominator) / Σ(denominator)` — and each stat has its own
denominator: possessions for ratings, minutes for usage and PIE, `FGA + 0.44×FTA`
for true shooting. Using the wrong one is a silent error. This is why stored rows
carry the denominators and not only the rates.

**No rank is ever stored.** Rank is a property of a date's whole field, so it is
assigned on read — by the API's sort, and by `build-source.ts` in the browser. A
stored rank could disagree with the score printed beside it; a computed one
cannot. It is also what makes "top 10 / top 50 / whole league" a query parameter.

**Rates are stored as fractions**, exactly as the API sends them: `usageRate`
0.288, `pie` 0.214, `trueShootingPercentage` 0.625. Nothing is transformed at
ingestion, so stored values can be diffed against the source at any time and no
normalisation can be applied twice or skipped. The formula owns every scaling
decision — PIE is ×100, usage and true shooting are not.

**Off days are not gaps.** Ten of the season's 174 days have no rows —
Thanksgiving, the NBA Cup final, Christmas Eve, the All-Star break, the day
before the finale — and that is correct, because no games were played. The front
end resolves an off day to the previous game day, so every date shows a board and
charts run flat. That is not interpolation: a season-to-date figure cannot change
on a day nobody played, so the flat line *is* the measurement.

**Scores are derived from the box score, not stored separately.** A game's final
score is the sum of each side's box score, and the quarter scores from the NBA's
own scoreboard sum to the same total. `pnpm verify-games` asserts all three agree
across every one of the 1,230 games, so they cannot drift apart.

**One formula, one implementation.** `src/shared/mvp-formula.ts` is imported by
both the backend and the browser. Stored rows carry a `formulaVersion`; scores
from different versions are not comparable.

## Traps

These cost real debugging time. They are also commented at the call sites.

- **`GAME_DATE` carries a `T00:00:00` suffix**, so comparing it against
  `"2026-04-12"` silently drops the final day.
- **Two date forms per row.** `date` is `"M-D-YYYY"` — the public query key, and
  unsortable as text. `isoDate` is `"YYYY-MM-DD"`, which is what Mongo sorts on.
  Both are indexed.
- **`toISOString()` shifts the day** anywhere east of Greenwich. Build ISO
  strings from local date parts.
- **Advanced and Base endpoints return rows in different orders.** Join on
  `(PLAYER_ID, GAME_ID)`; never zip them.
- **The NBA API's header set is exact.** `Referer` must be `https://www.nba.com/`,
  and the widely-circulated `x-nba-stats-*` headers are wrong. When it declines it
  does not return 403 — it accepts the connection and never replies, so a bad
  header set looks exactly like a network outage.
- **A neutral-site `MATCHUP` reads `@` for both teams**, so home/away cannot be
  read off it. Hence `neutralSite` on the summary.
- **`videoId: null` is an answer, not a gap.** It means the resolver looked and
  found nothing, which is what stops the app retrying at read time.
- **Per-game inputs are legitimately out of range** — a single-game PIE of 6.0 or
  a net rating of −400 is a two-minute garbage-time cameo. Ranges are asserted
  *after* aggregation, not before. `POSS = 0` and `MIN = 0` rows exist and are
  both weights, so a zero total yields `NaN` and sorts unpredictably.
- **Aggregations over the whole collection fail on *wide* rows.** 83,054
  40-field documents exceed Mongo's 100 MB in-memory limit and return code 292.
  The limit is on what a stage materialises, not what it scans: `$project` to
  three fields first and `$setWindowFields` runs at ~3 MB. It is no faster than
  one indexed query per date, so the per-date pattern stands. Never `$push` whole
  documents.
- **`HistoryPoint` distinguishes two kinds of nothing.** `noGames` belongs to the
  date; a null `rank` on a day that did have games belongs to the player. Only
  the first is carried forward. Blur them and a rookie gets a rank before his
  first game.
- **`boxscoresummaryv2` is broken for this season** — `scoreboardv3` is the
  working source (nba_api#596).
- **Availability must be anchored to the season, not to a player's own games.**
  A window defined by a player's appearances can never see the games he missed:
  it once gave Jayson Tatum an availability of 0.89 on 16 games played.

## Running it

```bash
pnpm build-season          # fetch → compute → verify (--apply to write)
pnpm verify-db             # recompute from raw logs, check every stored row
pnpm fetch-summaries       # quarter and final scores
pnpm verify-games          # 12 cross-checks between logs and summaries
pnpm resolve-highlights    # map games to YouTube reels
pnpm add-highlight <gameId> <videoId>   # by hand; survives a re-run
pnpm generate-fixture      # rewrite the committed public/rankings.json
pnpm test                  # 210 tests, no database or network needed
```

Deployment is two Render services: the API as a Web Service (`pnpm build`,
`pnpm start`) and the front end as a Static Site (root `src/front-end`, publish
`dist`). The static site needs `VITE_DATA=api` and `VITE_API_BASE` at **build**
time — Vite bakes them in, and a build without them silently serves the committed
fixture forever. It also needs a `/*` → `/index.html` rewrite rule, or refreshing
on a profile URL 404s.

## History

This began as a nightly Basketball Reference scraper that read the top ~20
players by points per game and copied their VORP, Win Shares and BPM. That model
had three faults: a failed night was gone forever, candidates were selected by
the very statistic the project argues is a poor guide, and the most important half
of the score was computed by somebody else.

Rebuilding on the NBA's own API fixed all three at once. Every player is ranked
rather than twenty. Gaps became structurally impossible, because a game either
happened or it did not and every game of a finished season is on record. And the
quality term moved from `0.4(VORP + WS) + 0.2(BPM)` to `0.4(PIE × 100) + 0.2(NR)`
— both measured per game from tracking data rather than inferred from a box score.

The honesty claim moved with it: from *"we show you our gaps"* to *"every number
here was measured, per game, from the league's own data"* — a stronger claim, and
one the data model enforces rather than asserts.

`src/services/scraper/scrape-player-game-log.ts` survives from that era. It parses
a Basketball Reference game log and is still used by `pnpm fetch-game-logs` and
`pnpm migrate`; its 30 tests run against a saved page. Nothing in the live request
path touches it.

## Not a multi-sport refactor

The long-term intent is to track an MVP race in any sport. That does not mean
building a sport abstraction now. Other sports will be separate applications with
their own ingestion and their own formula. An interface designed before a second
sport exists would be shaped entirely around basketball, and the second sport
would spend its life fighting it. The goal is to be clean enough to **copy**, not
generic enough to **configure**.
