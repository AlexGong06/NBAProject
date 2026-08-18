# NBA MVP Tracker

Ranks every player in the NBA by a custom MVP score, for every day of a season,
so you can watch the race move rather than only see today.

The point of the project is the gap it makes visible: the media narrative through
a season is often a poor guide to who is actually playing the best. Ranking runs
on box score, efficiency and team record only, with no input from how much a
player is being discussed.

The formula started from
[this article](https://medium.com/data-science/nba-mvp-predictor-c700e50e0917)
and has been revised since.

> **Rebuilt on the official NBA stats API.** It previously scraped Basketball
> Reference once a night for the top ~20 scorers and copied their advanced
> metrics. It now derives rolling metrics from real possession counts and scores
> all **582 players on each of the 164 game dates** of 2025-26 — 83,054 stored
> values, rebuilt from scratch in about three minutes. The design rationale is
> in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run the front end

No database required. The app ships with a real window of data exported from the
production database, in `src/front-end/public/rankings.json`.

```bash
cd src/front-end
pnpm install
pnpm dev
```

Nothing in the front end computes a score. Every number on screen was calculated
once by the backend and stored — the UI reads and ranks, it never derives.

### Running against the real API instead

```bash
VITE_DATA=api VITE_API_BASE=http://localhost:3000 pnpm dev
```

This needs the Express API and MongoDB up (see below). Fixture mode is the
default so a fresh clone works immediately.

## The score

```
Total Value = availability × (0.5 Win Contribution + 0.5 Total Stats)

availability = games played / team games played

Win Contribution = level of impact × quality of impact
  level of impact   = (wins / games) × (MPG / 48) × USG
  quality of impact = 0.4(PIE × 100) + 0.2(NR)

  USG = usage rate, the fraction the API returns (0.288)
  PIE = Player Impact Estimate, also a fraction (0.214)
  NR  = Offensive Rating − Defensive Rating

Total Stats = (PTS × TS% + 1.5 AST + 1.2 REB + 3 BLK + 3 STL − PF − TOV) / 25
```

Half the score is what a player does for winning basketball; half is raw
production, efficiency-weighted. The whole thing is then scaled by how much of
the season the player was actually there for.

**Availability is the only term that notices absence.** PIE and Net Rating are
both rates — a share of the game's events, and points per 100 possessions.
Neither accrues, so a player who misses thirty games looks identical to one who
missed none until the multiplier is applied. Without it, a player who appeared in
25 games scored 84.5% of an ever-present peer while playing 45% of the games.

**Why the `× 100` sits inside the parentheses.** PIE arrives as a fraction and
has to reach the same scale as Net Rating, but writing it as `40 × PIE` — which
is arithmetically identical — would hide the 0.4-to-0.2 weighting and make a
future retune to 0.5 mean writing `50`. The weights stay legible.

Implemented in `src/shared/mvp-formula.ts`, imported by both the backend and the
browser so there is exactly one copy. Stored rows carry a `formulaVersion`;
scores from different versions are not directly comparable.

Known limits: team record is a season ratio rather than a rolling window, and
**players who change teams mid-season need care** — `wins / games` and
`availability` both depend on *which* team's record you mean. A traded player's
games accumulate across both clubs while either club's record alone is the wrong
denominator. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#players-who-change-teams).

## What the NBA API actually returns

This is the part most likely to produce a wrong answer that looks right, so it is
written down rather than left in the code.

**One real row** — Nikola Jokić, 3 December 2025, from
`PlayerGameLogs(MeasureType=Advanced)`:

```json
{
  "GAME_DATE":   "2025-12-03T00:00:00",
  "MATCHUP":     "DEN @ IND",
  "WL":          "W",
  "MIN":         35.3,
  "PIE":         0.177,
  "USG_PCT":     0.288,
  "TS_PCT":      0.625,
  "NET_RATING":  32.1,
  "OFF_RATING":  144.6,
  "DEF_RATING":  112.5,
  "POSS":        74
}
```

**Rates come back as fractions**, where Basketball Reference returned
percentages. Only some of them need scaling, and a blanket "multiply everything
by 100" is wrong — it would turn true shooting into `62.5` and inflate the Total
Stats term sixty-fold.

| Field | API returns | How the formula uses it | Transformed on ingest |
|---|---|---|---|
| `USG_PCT` | `0.288` | as the usage factor directly | **no** |
| `PIE` | `0.214` | `× 100` inside the formula | **no** |
| `TS_PCT` | `0.625` | as a decimal, unchanged | **no** |
| `NET_RATING` | `10.74` | unchanged | **no** |

**Nothing is transformed at ingestion.** Stored values are byte-identical to the
API response, so they can be diffed against the source at any time and there is
no normalisation step that could be applied twice or skipped.

**Per-game values are extreme.** Measured across all 26,651 player-games of the
2025-26 season:

```
PIE          min  -11.000   median  0.090   max   6.000
NET_RATING   min -400.000   median  0.000   max 300.000
USG_PCT      min    0.000   median  0.177   max   1.000
TS_PCT       min    0.000   median  0.560   max   1.500
POSS         min    0.000   median 49.000   max 122.000
MIN          min    0.000   median 23.400   max  52.300
```

A single-game PIE of `6.0` or a net rating of `−400` is real — a two-minute
garbage-time appearance where the denominator is almost nothing. Weighted across
a season they collapse to sane values; season PIE tops out around `0.213`.

Two things follow. **`POSS = 0` and `MIN = 0` rows exist**, and both are weights,
so a zero total yields `NaN` and sorts unpredictably. And **ranges are asserted
after aggregation, not before** — per-game inputs are legitimately out of range,
season-to-date values are not.

Two more traps worth knowing about the payload: `GAME_DATE` carries a
`T00:00:00` suffix, so comparing it against `"2026-04-12"` silently drops the
final day; and the Advanced and Base endpoints return rows in **different
orders**, so they must be joined on `(PLAYER_ID, GAME_ID)` rather than zipped.

## How rolling stats are calculated

The single rule that governs the pipeline: **advanced statistics are never
averaged across games.**

Every one of them is a rate. Averaging two games' rates weights a 12-minute
blowout the same as a 44-minute overtime game. The correct method recovers the
raw volume, sums it, and re-divides:

```
rolling rate = Σ(game rate × game denominator) / Σ(game denominator)
```

Each stat has its own denominator, and using the wrong one is a silent error:

| Stat | Weighted by |
|---|---|
| Offensive / Defensive / Net Rating | possessions |
| Usage percentage | minutes played |
| PIE | minutes played |
| True shooting | FGA + 0.44 × FTA |
| Per-game box score averages | games played |

Concretely: a 130 offensive rating over 100 possessions followed by a 90 over 10
possessions averages to 110, but weights to **126.4**. The second game barely
happened and the arithmetic should say so.

This is why stored rows carry the **denominators** and not only the rates, and
why any date's leaderboard is a sum over games up to that date rather than a
sample taken on it.

### Two things the data forced

**A single game's PIE is sometimes impossible.** PIE is a player's share of the
game's total events, so it cannot honestly leave `[-1, 1]`. Twelve rows out of
26,638 do — Joan Beringer at `-11.0` in 4.8 minutes, Chris Boucher at `+6.0` in
3.0 — all of them cameos where the denominator collapses. Minute-weighting alone
does not absorb them: that one game held Beringer's season PIE below `-0.85`
through thirteen games. Games beyond `|PIE| > 2` are therefore excluded from
that average only — not from minutes, not from the box score, and not from the
stored game log, which stays byte-identical to the API.

**Availability has to be anchored to the season, not to a player's own games.**
Team context was originally counted between a player's first and last
appearance. That window is defined by his appearances, so it can never see the
games he missed:

```
Jayson Tatum, 2026-04-12    16 games played, "availability" 0.89
                            ranked 5th in the league
```

Anchoring each stint to the season instead gives `16/82 = 0.195`. Stints still
split at a trade, so a traded player's two clubs each contribute their own
games — the case that motivated stint-awareness in the first place — but the
first stint now opens at the season start and the last runs to the date being
scored.

Early-season volatility is deliberately preserved: when everyone has played six
games, anyone healthy has an availability of 1.0 under either rule. An unknown
player topping the board in November is a real signal, and the two rules produce
near-identical boards there. What changed is only the player who *missed* the
games.

## Tests

```bash
pnpm install
pnpm test
```

No database or network needed. They cover the scoring formula, the `"M-D-YYYY"`
date key, the game-log parser (against a saved page), and the front end's data
layer — the places where a wrong answer still looks like a right answer. Each
test says in a comment what failure it guards against.

## Backend

```bash
pnpm install

cat > .env <<'EOF'
MONGO_URI=<a mongodb connection string>
NBA_SEASON=2026
EOF

pnpm start-server         # Express API on :3000
```

There is no bundled database. `MONGO_URI` points at whatever you have — Atlas, or
a local `mongod`. Fixture mode above exists so you don't need one.

API surface:

| Route | Returns |
|---|---|
| `GET /daily-mvp-rankings` | every stored record, newest date first |
| `GET /daily-mvp-rankings/:date` | one date (`M-D-YYYY`), 404 when none exists |
| `GET /players/:playerName/daily-mvp-rankings` | one player's history |

Rank is **not stored**. It is a property of a date's rows, computed when asked, so
a stored rank can never disagree with the score printed beside it.
