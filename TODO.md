# TODO

The front-end work this file used to describe is done: the rankings page with
date search, the player view with an adjustable rank-over-time chart, the
next-10-games and ticket placeholders, and the missing-day handling. See the
README for how to run it.

What's left, roughly in the order it should happen.

Run the tests with `pnpm test` from the project root.

## Correctness

- **Tests: two of four tiers done.** `pnpm test` covers the scoring formula and
  the date key. Still missing:
  - The scraper, run against saved Basketball Reference HTML rather than the
    network. Needs the `page.evaluate` callbacks in
    `scrape-full-player-stats.ts` extracted into pure functions over a
    `Document` first, then `jsdom`. Highest-value case: a traded player, since
    the "2TM" fix has nothing pinning it.
  - The API routes. `getDb()` is a module singleton, so routes can't be tested
    without a live Mongo — inject the db, then `supertest` the 404-on-missing-date
    behaviour the whole front end is built around.
- **The header comment on the scoring formula is wrong.**
  `calculate-player-value.ts:5` writes Total Stats as
  `Points * True Shooting % * 1.5(Assists) + ...` — a multiplication where the
  code has a plus. The code is right and is now pinned by a test; the comment
  needs correcting.
- **Dead null-guards.** `calculate-player-value.ts:23,30-31` check for null on
  `usageRate`, `valueOverReplacement`, `winShare` and `boxPlusMinus`, but
  `types.ts` declares all four as non-nullable `z.number()` and the scraper
  validates before returning. Either the schema should be `.nullable()` or the
  guards should go.
- **The scraper's own recovery path crashes.**
  `scrape-full-player-stats.ts:85` logs a warning when a player has no per-game
  row, then line 91 reads `perGameStats.team` unconditionally. The warning is
  immediately followed by a TypeError.
- **Reruns duplicate rows.** `insert-data-into-database.ts` does a bare
  `insertOne` per player with no unique key on `(date, player)`. Running the
  scraper twice in a day stores every player twice.
- **Partial days look complete.** The same file catches a failed insert, logs
  it, and continues. Five of eight players stored means the API returns 200
  with a ranking that is quietly wrong — worse than a missing day, because
  there is no signal at all.
- **The scoring formula exists twice.** `src/services/mvp-calculation/calculate-player-value.ts`
  and `breakdown()` in `src/front-end/src/data/fixture.ts` are hand copies of
  each other. Change one and the "How it works" panel starts showing a formula
  the backend no longer uses. Extract to a module both import.
- **Collector failures are still unfixed.** The app now reports the gaps
  honestly, but the scraper still drops days. Find out why before adding
  anything else.

## Packaging

- `pnpm demo` at the root that runs the front end in fixture mode, so a fresh
  clone is one command.
- Root `package.json` lists `react` and `vite` as backend dependencies. They
  belong to `src/front-end/`.

## Backend gaps

- The schedule and ticket links on the player view are fixture-only. There is
  no route behind them. Either add one or keep them clearly marked as
  placeholders.
- No route serves a single player's full stat line; the profile view currently
  derives everything from the rankings payload.

## Data source

- Investigate pulling stats from an API instead of scraping. Blocker to check
  first: the formula needs VORP, Win Shares, BPM, USG% and TS%, which
  Basketball Reference computes rather than reports. Most free NBA APIs serve
  raw box scores only. If that holds, an API can supplement the scraper but
  can't replace it.
- If both sources end up in play, put them behind one interface the way
  `DataSource` works on the front end, rather than branching at the call site.
