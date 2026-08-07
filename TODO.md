# TODO

The front-end work this file used to describe is done: the rankings page with
date search, the player view with an adjustable rank-over-time chart, the
next-10-games and ticket placeholders, and the missing-day handling. See the
README for how to run it.

What's left, roughly in the order it should happen.

## Correctness

- **No test suite.** Start with `calculate-player-value.ts` — it's a pure
  function with known inputs, and it's the heart of the project. Then a test
  that a date with no scrape surfaces as missing rather than as zero
  candidates.
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
