# NBAProject

NBA MVP Tracker — scrapes daily player stats from basketball-reference.com,
applies a custom MVP scoring formula, stores ranked results in MongoDB Atlas,
and displays them in a React web app.

## Tech Stack

- **Backend**: TypeScript, Express 5, Playwright (scraping), MongoDB (Atlas), Zod, Pino
- **Frontend**: React 19, TypeScript, Vite 7, CSS Modules
- **Package manager**: pnpm (separate installs for root and `src/front-end/`)
- **CI/CD**: GitHub Actions — runs scraper daily at 04:00 UTC (`.github/workflows/scheduled.yml`)
- **TypeScript**: strict mode disabled; `src/front-end/` excluded from root tsconfig

## Project Structure

```
src/
  main.ts                          # Entry point — runs scrape pipeline
  web-automation.ts                # Orchestrates: scrape -> calculate -> save
  utils/
    types.ts                       # All Zod schemas + derived TS types (single source of truth)
    logger.ts                      # Pino logger setup
  database/
    database.ts                    # Singleton MongoDB connection (lazy init)
  services/
    scraper/                       # Playwright scrapers for basketball-reference.com
    mvp-calculation/               # Custom MVP value formula
    database/                      # DB insert operations
  api/
    index.ts                       # Express server (port 3000, CORS enabled)
    routes/
      daily-mvp-rankings.ts       # GET /daily-mvp-rankings[/:date]
      players.ts                  # GET /players/:playerName/daily-mvp-rankings
  front-end/                       # Separate React app (own package.json + Vite config)
    src/components/
      DailyMvpRankings.tsx        # Data-fetching container
      PlayerRankingsRow.tsx       # Expandable player card
```

## Commands

### Backend (run from project root)

| Command | Description |
|---|---|
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run the scraper pipeline (`ts-node src/main.ts`) |
| `pnpm start-server` | Start Express API server (`ts-node src/api/index.ts`) |

### Frontend (run from `src/front-end/`)

| Command | Description |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Type-check + production build |
| `pnpm lint` | ESLint |

## Environment Variables

Set in `.env` (local) or GitHub Secrets (CI):

- `MONGO_URI` — MongoDB Atlas connection string
- `NBA_SEASON` — e.g., `"2026"`

## Notes

- **No test suite** — no test files or test runners exist yet.
- **Unused scrapers**: `scrape-mvp-rankings-from-website.ts` and `scrape-daily-stats-leaders.ts`
  are not called by the main pipeline.
- Dates stored as `"M-D-YYYY"` strings (not ISO), used as DB query keys.

## Additional Documentation

Check these files for deeper context on specific topics:

- [Architectural Patterns](.claude/docs/architectural_patterns.md) — pipeline design, Zod schema
  chain, DB connection pattern, React component patterns, MVP formula breakdown
