# NBA MVP Tracker

Tracks the top MVP candidates through a season. A Playwright scraper collects
player and team data from [basketball-reference](https://www.basketball-reference.com/)
on a schedule, a scoring function ranks every tracked player, and the rankings
are stored per day so you can watch the race move rather than just see today.

The point of the project is the gap it makes visible: the media narrative
through a season is often a poor guide to who is actually playing the best.
Ranking runs on box score and team record only, with no input from how much a
player is being discussed.

## Run the front end

No database required. The app ships with 30 days of generated fixture data —
eight real players, the real scoring formula, invented day-to-day movement —
including three days where the collector failed, so the empty state is a real
state rather than a mock. Everything lives in
`src/front-end/src/data/fixture.ts`.

```bash
cd src/front-end
pnpm install
pnpm dev
```

Then open the printed URL. Things worth clicking:

- **The scrape ribbon** at the top. Hollow, dashed cells are days the collector
  failed. Click one to see how the app reports a gap.
- **⌘K** to search players, or any row to open a profile.
- **Rank / Value / Field** on a profile chart. Dashed segments span days with no
  data; they are never interpolated.
- **How it works** in the nav, which shows the scoring formula with that
  player's numbers substituted in.

### Running against the real API instead

```bash
VITE_DATA=api VITE_API_BASE=http://localhost:3000 pnpm dev
```

This needs the Express API and MongoDB up (see below). Fixture mode is the
default so a fresh clone works immediately.

## The score

```
Total Value = 0.5 (Win Contribution) + 0.5 (Total Stats)

Win Contribution = level of impact × quality of impact
  level of impact   = (wins / games) × (MPG / 48) × (USG% / 100)
  quality of impact = 0.4(VORP + WS) + 0.2(BPM)

Total Stats = (PTS × TS% + 1.5 AST + 1.2 REB + 3 BLK + 3 STL − PF − TOV) / 25
```

Half the score is what a player does for winning basketball; half is raw
production, efficiency-weighted. Implemented in
`src/services/mvp-calculation/calculate-player-value.ts`, and mirrored in the
front end's fixture module so the UI can show the working.

Known limits: Total Stats dominates the sum for high-usage scorers, team record
is a season ratio rather than a rolling window, and days the collector fails are
left as gaps.

## Backend

The scraper, API and database run separately from the front end.

```bash
pnpm install

cat > .env <<'EOF'
MONGO_URI=<a mongodb connection string>
NBA_SEASON=2026
EOF

pnpm start                # run the scraper once
pnpm start-server         # Express API on :3000
```

There is no bundled database. `MONGO_URI` points at whatever you have —
Atlas in CI, or a local `mongod`. Fixture mode above exists so you don't
need one to see the app.

API surface:

| Route | Returns |
|---|---|
| `GET /daily-mvp-rankings` | every record across all dates, newest first |
| `GET /daily-mvp-rankings/:date` | one date (`M-D-YYYY`), 404 when no scrape ran |
| `GET /api/players/:playerName/daily-mvp-rankings` | one player's history |

The 404 is deliberate. A day with no scrape is not a day with no candidates, and
collapsing the two would let a collector failure look like a real result.
