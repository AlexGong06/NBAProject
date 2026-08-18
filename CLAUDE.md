# NBAProject

NBA MVP Tracker — reconstructs the 2025-26 season from the official NBA stats
API, applies a custom MVP scoring formula to every player on every date, stores
the values in MongoDB Atlas, and displays them in a React web app.

The season is complete and nothing new arrives; the whole season is computed
retroactively. There is no scheduled job and no daily scrape.

## Tech Stack

- **Backend**: TypeScript, Express 5, MongoDB (Atlas), Zod, Pino
- **Data source**: `stats.nba.com` JSON endpoints over plain `fetch` — no
  Playwright, no Python at runtime
- **Frontend**: React 19, TypeScript, Vite 7
- **Testing**: Vitest, co-located `*.test.ts`
- **Package manager**: pnpm (separate installs for root and `src/front-end/`)
- **TypeScript**: strict mode disabled; `src/front-end/` excluded from root tsconfig

## Project Structure

```
src/
  shared/
    mvp-formula.ts                 # THE formula. The only implementation.
  utils/
    types.ts                       # All Zod schemas + derived TS types
    date-key.ts                    # "M-D-YYYY" keys — parse/compare/sort
    logger.ts                      # Pino logger setup
  database/
    database.ts                    # Singleton MongoDB connection (lazy init)
  services/
    nba-api/
      client.ts                    # fetch wrapper + the required header set
      fetch-season.ts              # 5 calls -> a whole season of game logs
      season-to-date.ts            # rolling aggregation, stint-aware team context
    mvp-calculation/               # scores a list of players, sorts by value
    scraper/                       # LEGACY Basketball Reference scrapers (unused)
  api/
    index.ts                       # Express server (port 3000, CORS enabled)
    routes/
      daily-mvp-rankings.ts        # GET /daily-mvp-rankings[/:date]?top=N
      players.ts                   # GET /players/:playerName/daily-mvp-rankings
  front-end/                       # Separate React app (own package.json + Vite)
    src/components/                # RankingsView, PlayerProfileView, FormulaPanel...
    src/data/                      # build-source.ts turns stored rows into the UI model
    public/rankings.json           # committed fixture — runs with no database
scripts/
  build-season.ts                  # THE pipeline: fetch -> compute -> write
  verify-database.ts               # independent recompute + invariant check
  generate-fixture.ts              # export public/rankings.json from the DB
  cleanup-legacy-data.ts           # retire the Basketball Reference collections
```

## Commands

### Backend (run from project root)

| Command | Description |
|---|---|
| `pnpm build-season` | Dry-run the whole season: fetch, compute, verify, report |
| `pnpm build-season --apply` | ...and write to MongoDB |
| `pnpm verify-db` | Recompute from raw logs and check every stored row |
| `pnpm generate-fixture` | Rewrite `src/front-end/public/rankings.json` |
| `pnpm cleanup` | Dry-run retiring the legacy collections (`--apply` to do it) |
| `pnpm test` | Vitest, whole repo including front end |
| `pnpm start-server` | Start Express API server |
| `pnpm build` | Compile TypeScript to `dist/` |

### Frontend (run from `src/front-end/`)

| Command | Description |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Type-check + production build |

## Environment Variables

- `MONGO_URI` — MongoDB Atlas connection string
- `NBA_SEASON_LABEL` — optional, defaults to `"2025-26"`

## Collections

- **`PlayerGameLogs2526`** — raw fact, one row per player per game, exactly as
  the API returned it. The event source: a formula change is a recompute, never
  a re-fetch. `_id` is `${playerId}:${gameId}`.
- **`PlayerDailyValues`** — one row per player per date (83,054), carrying
  season-to-date inputs, every term of the formula, and `mvpValue`.
  `_id` is `${playerId}:${isoDate}`.
- `DailyMvpRankings`, `DailyStatsLeaders` — legacy, superseded, safe to drop via
  `pnpm cleanup`.

## Things that will bite you

- **No rank is stored.** Rank is a property of a date's whole field and is
  assigned on read — by the API's sort, and by `build-source.ts` in the browser.
  This is what makes "top 10 / top 50 / whole league" a query parameter.
- **Rates are stored as FRACTIONS**, exactly as the API sends them: `usageRate`
  0.288, `pie` 0.214, `trueShootingPercentage` 0.625. `netRating` is already per
  100 possessions. The formula owns every scaling decision — PIE is ×100, usage
  and true shooting are not. Anything displaying them as a percentage multiplies
  by 100 itself.
- **Two date forms per row.** `date` is `"M-D-YYYY"` (the public query key, and
  unsortable as text); `isoDate` is `"YYYY-MM-DD"` (what Mongo sorts on). Both
  are indexed.
- **Aggregations over the whole collection fail.** 83,054 wide rows exceed
  Mongo's 100 MB in-memory limit — both `$group`/`$push` and `$setWindowFields`
  return code 292. Query one date at a time against the
  `{ isoDate: 1, mvpValue: -1 }` index instead; it is also faster than
  `allowDiskUse`.
- **`src/services/scraper/`** is retained Basketball Reference code that nothing
  in the live path calls.

## Additional Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the design and its rationale
- [README.md](README.md) — the formula, and what the NBA API actually returns
- [week-plan.md](week-plan.md) — the execution plan this was built from
