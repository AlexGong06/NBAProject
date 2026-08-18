// Measures how wrong the interpolated advanced stats actually are.
//
//   pnpm validate-estimates
//
// Takes days that WERE scraped, pretends they were missed, reconstructs them
// from the real observations either side, and compares the result to what was
// really recorded. Read-only — it writes nothing.
//
// Two questions, and the second is the one that matters:
//
//   1. How far off are VORP, Win Shares and BPM?
//   2. How often does the reconstructed day produce a different leaderboard?
//
// A large error in a stat nobody looks at directly is tolerable; a small error
// that reorders the top five is not. The second number is what belongs in the
// README, and what decides whether the eight-day February outage gets filled or
// left as a gap.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { compareDateKeys } from "../src/utils/date-key";
import { scoreBreakdown } from "../src/shared/mvp-formula";
import { interpolateAdvanced } from "../src/services/mvp-calculation/estimate-advanced-stats";

dotenv.config();

/** Gap widths to simulate. 1 covers seven of the eight real runs; 8 is February. */
const WIDTHS = [1, 2, 4, 8];

type Row = Record<string, any>;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[i];
}

const fmt = (n: number, d = 3) => n.toFixed(d).padStart(7);

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();
  const rows: Row[] = await client
    .db("NbaDb")
    .collection("DailyMvpRankings")
    .find({})
    .toArray();

  // Real rankings per date, for the leaderboard comparison.
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const dates = [...byDate.keys()].sort(compareDateKeys);

  // Each player's own series, in date order.
  const byPlayer = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.player) ?? [];
    list.push(r);
    byPlayer.set(r.player, list);
  }
  for (const list of byPlayer.values()) {
    list.sort((a, b) => compareDateKeys(a.date, b.date));
  }

  console.log(`\n  ${rows.length} rows, ${dates.length} dates, ${byPlayer.size} players`);

  for (const width of WIDTHS) {
    // date -> player -> reconstructed advanced stats
    const rebuilt = new Map<string, Map<string, ReturnType<typeof interpolateAdvanced>>>();
    const errVorp: number[] = [];
    const errWs: number[] = [];
    const errBpm: number[] = [];
    const errScore: number[] = [];

    for (const series of byPlayer.values()) {
      // Anchor at i, anchor at i+width+1, reconstruct everything between.
      for (let i = 0; i + width + 1 < series.length; i++) {
        const before = series[i];
        const after = series[i + width + 1];

        for (let k = 1; k <= width; k++) {
          const truth = series[i + k];

          // Only meaningful if games played is inside the anchors, which it is
          // by construction — but a traded player's log can be ragged.
          if (
            truth.gamesPlayed < before.gamesPlayed ||
            truth.gamesPlayed > after.gamesPlayed
          ) {
            continue;
          }

          const est = interpolateAdvanced(
            {
              gamesPlayed: before.gamesPlayed,
              valueOverReplacement: before.valueOverReplacement,
              winShare: before.winShare,
              boxPlusMinus: before.boxPlusMinus,
            },
            {
              gamesPlayed: after.gamesPlayed,
              valueOverReplacement: after.valueOverReplacement,
              winShare: after.winShare,
              boxPlusMinus: after.boxPlusMinus,
            },
            truth.gamesPlayed,
          );

          errVorp.push(Math.abs(est.valueOverReplacement - truth.valueOverReplacement));
          errWs.push(Math.abs(est.winShare - truth.winShare));
          errBpm.push(Math.abs(est.boxPlusMinus - truth.boxPlusMinus));

          // Rescore the day with the estimated advanced stats and everything
          // else exactly as recorded.
          const rescored = scoreBreakdown({
            teamWins: truth.teamWins,
            teamGamesPlayed: truth.teamGamesPlayed,
            gamesPlayed: truth.gamesPlayed,
            minutesPerGame: truth.minutesPerGame,
            usageRate: truth.usageRate,
            valueOverReplacement: est.valueOverReplacement,
            winShare: est.winShare,
            boxPlusMinus: est.boxPlusMinus,
            pointsPerGame: truth.pointsPerGame,
            assistsPerGame: truth.assistsPerGame,
            reboundsPerGame: truth.reboundsPerGame,
            blocksPerGame: truth.blocksPerGame,
            stealsPerGame: truth.stealsPerGame,
            foulsPerGame: truth.foulsPerGame,
            turnoversPerGame: truth.turnoversPerGame,
            trueShootingPercentage: truth.trueShootingPercentage,
          });
          errScore.push(Math.abs(rescored.mvpValue - truth.mvpValue));

          const day = rebuilt.get(truth.date) ?? new Map();
          day.set(truth.player, { ...est, mvpValue: rescored.mvpValue } as any);
          rebuilt.set(truth.date, day);
        }
      }
    }

    // Leaderboard impact: rebuild each date where every player was reconstructed
    // and see whether the ordering changed.
    let comparable = 0;
    let top1Changed = 0;
    let top5Changed = 0;
    let anyRankChanged = 0;

    for (const [date, ests] of rebuilt) {
      const real = byDate.get(date)!;
      if (ests.size !== real.length) continue; // partial coverage, skip
      comparable++;

      const estOrder = [...real]
        .map((r) => ({ player: r.player, v: (ests.get(r.player) as any).mvpValue }))
        .sort((a, b) => b.v - a.v)
        .map((r) => r.player);
      const realOrder = [...real]
        .sort((a, b) => a.calculatedRank - b.calculatedRank)
        .map((r) => r.player);

      if (estOrder[0] !== realOrder[0]) top1Changed++;
      if (estOrder.slice(0, 5).join() !== realOrder.slice(0, 5).join()) top5Changed++;
      if (estOrder.join() !== realOrder.join()) anyRankChanged++;
    }

    const s = (a: number[]) => [...a].sort((x, y) => x - y);
    const [v, w, b, sc] = [s(errVorp), s(errWs), s(errBpm), s(errScore)];

    console.log(`\n  ── gap width ${width} day${width > 1 ? "s" : ""} ` + "─".repeat(46));
    console.log(`  reconstructed points: ${v.length}`);
    console.log("                     median      p90      max");
    console.log(`    VORP error      ${fmt(quantile(v, 0.5))}  ${fmt(quantile(v, 0.9))}  ${fmt(v[v.length - 1] ?? 0)}`);
    console.log(`    Win Share error ${fmt(quantile(w, 0.5))}  ${fmt(quantile(w, 0.9))}  ${fmt(w[w.length - 1] ?? 0)}`);
    console.log(`    BPM error       ${fmt(quantile(b, 0.5))}  ${fmt(quantile(b, 0.9))}  ${fmt(b[b.length - 1] ?? 0)}`);
    console.log(`    MVP score error ${fmt(quantile(sc, 0.5))}  ${fmt(quantile(sc, 0.9))}  ${fmt(sc[sc.length - 1] ?? 0)}`);

    if (comparable > 0) {
      const pct = (n: number) => `${((n / comparable) * 100).toFixed(1)}%`;
      console.log(`  fully reconstructed days: ${comparable}`);
      console.log(`    #1 differs        ${pct(top1Changed)}`);
      console.log(`    top 5 differs     ${pct(top5Changed)}`);
      console.log(`    any rank differs  ${pct(anyRankChanged)}`);
    }
  }

  console.log();
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
