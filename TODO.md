# TODO

The front-end work this file used to describe is done: the rankings page with
date search, the player view with an adjustable rank-over-time chart, the
next-10-games and ticket placeholders, and the missing-day handling. See the
README for how to run it.

What's left, roughly in the order it should happen.

Run the tests with `pnpm test` from the project root.

## Backfilling last season (not done)

Formula version 2 added availability, and it applies from the next scrape
onward. Rows already in MongoDB were computed under version 1 and still are.

This is deliberate. The 2025-26 season is finished, so the change lands on a
season boundary rather than mid-race — nobody compares a rank from last May to
one from this November. Old rows stay internally consistent with each other.

If those rows are ever recomputed, two things matter:

- **Do not delete and rebuild the season.** Game logs give box-score stats per
  date, so per-game averages and TS% are reconstructible — but VORP, Win Shares
  and BPM are not box-score arithmetic. They need league-wide context and are
  published pre-computed. Approximating them makes every historical score
  subtly wrong with nothing to flag it. Meanwhile every row already in Mongo
  carries the real as-of-date advanced stats, captured on the day. Those daily
  snapshots cannot be regenerated from anywhere.
- **Only `gamesPlayed` is missing**, and game logs give it exactly. Fetch
  `/players/{initial}/{playerId}/gamelog/{season}/`, and read the cumulative
  `data-stat="ranker"` column at the target date. Do NOT count rows: the log
  lists all 82 team games including DNPs, so Jokić has 82 rows and 70 games
  played. `ranker` increments only on games played and repeats on DNP rows.
  Verified against the live 2026 log — Jokić had played 36 games as of
  2026-02-05.

Also note that reconstruction would fill in the three days the collector
failed. Those gaps are the most honest thing in the dataset and the app is
built to show them; manufacturing them would delete the evidence.

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
- **Dead null-guards.** `calculate-player-value.ts` checks for null on
  `usageRate`, `valueOverReplacement`, `winShare` and `boxPlusMinus`, but
  `types.ts` declares all four as non-nullable `z.number()` and the scraper
  validates before returning. Either the schema should be `.nullable()` or the
  guards should go.
- **The scraper's own recovery path crashes.** `scrape-full-player-stats.ts`
  logs a warning when a player has no per-game row, then reads
  `perGameStats.team` unconditionally a few lines later. The warning is
  immediately followed by a TypeError.
- **The scoring formula exists in THREE places.**
  `src/services/mvp-calculation/calculate-player-value.ts`, `breakdown()` in
  `src/front-end/src/data/fixture.ts`, and again in that file's `SNAPSHOTS`
  builder, which recomputes `mvpValue` inline. Adding availability missed the
  third one and produced a leaderboard whose ranks did not match its own
  scores — rank 3 scoring below rank 4. Caught before it shipped, but only by
  printing the board. Extract to a module all three import.
- **The team record depends on Basketball Reference's own JavaScript.** The
  `wins`/`losses` cells live in a table the server wraps in an HTML comment;
  the page un-comments it client-side, which is why Playwright sees it and a
  plain fetch does not (verified in a real browser — it returns 50/32 for DEN
  2025). If that ever changes, `teamWins` comes back null and the Zod schema
  throws, which is the right failure. A non-commented fallback exists: the
  `#meta` div carries the plain text `Record: 50-32`.
- **Collector failures are still unfixed.** The app now reports the gaps
  honestly, but the scraper still drops days. Find out why before adding
  anything else.
- **Collector failures are still unfixed.** The app now reports the gaps
  honestly, but the scraper still drops days. Find out why before adding
  anything else.
- **Nothing validates on read.** Both routes hand Mongo documents straight to
  `res.json()`. `PlayerSummaryFromDatabaseSchema` in `types.ts` describes
  exactly what should come back and is imported by nothing. It matters most
  during a migration, when the collection holds rows of two shapes at once.

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
