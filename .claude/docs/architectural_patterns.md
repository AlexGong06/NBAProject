# Architectural Patterns

## Pipeline / Orchestrator Pattern

The scraper follows a sequential pipeline orchestrated by a single function.
Each stage produces output consumed by the next:

1. Launch browser -> 2. Scrape player list -> 3. Scrape full stats per player -> 4. Calculate MVP values -> 5. Save to DB

- Orchestrator: `src/web-automation.ts`
- Entry point: `src/main.ts`

All stages run in a single process invocation. Failures are not retried — the
entire pipeline runs again on the next scheduled execution.

## Zod-First Type System (Schema-Driven Validation)

All data shapes are defined as Zod schemas in `src/utils/types.ts`, with
TypeScript types derived via `z.infer<>`. This ensures runtime validation
matches compile-time types. Schemas form an inheritance chain:

```
PpgPlayerSummarySchema
  -> FullPlayerSummarySchema
    -> PlayerWithCalculatedMvpValueSchema (adds mvpValue, calculatedRank)
      -> PlayerSummaryFromDatabaseSchema (adds date)
```

Every data boundary (scraper output, calculation output, DB input) is
validated through these schemas before proceeding.

## Singleton DB Connection with Lazy Init

`src/database/database.ts` caches the MongoDB client in a module-level
variable (`cachedDb`). First call connects; subsequent calls reuse the
connection. This avoids reconnecting on each Express request or pipeline run.

## Express Router Modules

Each API resource gets its own `Router` in `src/api/routes/`, exported and
mounted in `src/api/index.ts`. Routes follow REST conventions:

- `GET /daily-mvp-rankings` — all rankings (sorted date desc)
- `GET /daily-mvp-rankings/:date` — single day's rankings
- `GET /players/:playerName/daily-mvp-rankings` — player history

## DOM Scraping via page.evaluate()

Playwright's `page.evaluate()` runs raw JS in the browser context to extract
data using `document.querySelector`, `CSS.escape()`, and XPath. Results are
passed back to Node.js and immediately validated with Zod schemas.

See: `src/services/scraper/scrape-full-player-stats.ts`,
`src/services/scraper/scrape-points-per-game-leaders.ts`

## React: Container + Presentational Components

- **Container**: `src/front-end/src/components/DailyMvpRankings.tsx` — fetches
  data via `useEffect`/`useState`, filters to latest date, sorts by rank,
  passes records as props.
- **Presentational**: `src/front-end/src/components/PlayerRankingsRow.tsx` —
  receives player data as props, manages local `isExpanded` state for
  accordion UI. Derives player image URL from `profileUrl` via string
  manipulation.

## MVP Scoring Formula

Custom weighted formula in `src/services/mvp-calculation/calculate-player-value.ts`:

```
Total Value = 0.5 * Win Contribution + 0.5 * Total Stats

Win Contribution = Level of Impact * Quality of Impact
  Level of Impact  = (TeamWins/GamesPlayed) * (MPG/48) * (Usage/100)
  Quality of Impact = 0.4 * (VORP + WinShare) + 0.2 * BPM

Total Stats = (PPG*TS% + 1.5*APG + 1.2*RPG + 3*BPG + 3*SPG - Fouls - TOV) / 25
```

## Date Format Convention

Dates are stored as `"M-D-YYYY"` strings (e.g., `"2-17-2026"`), not ISO
format. This format is used as the query key for daily ranking lookups
throughout the API and database layer.
