// Does stats.nba.com answer from here?
//
//   npx ts-node scripts/probe-nba-api.ts
//
// Written to settle one disputed question: whether the NBA declines requests
// from datacenter address ranges, or whether the timeouts people report from
// CI are just flaky endpoints. Those two look identical from a single machine,
// because this API declines by going quiet rather than by answering (see
// src/services/nba-api/client.ts). A timeout in CI on its own proves nothing.
//
// So this is a CONTROLLED probe. Run the same file in GitHub Actions and on the
// laptop within a few minutes of each other and read the pair:
//
//   cloud OK    · local OK     the address is not a blocker — the cloud is open
//   cloud FAIL  · local OK     the address IS the blocker. This is the finding.
//   cloud OK    · local FAIL   surprising; your network, not the NBA's opinion
//   cloud FAIL  · local FAIL   the endpoint is down for everyone. Learn nothing,
//                              wait and run the pair again.
//
// Reads no secrets, touches no database, writes nothing. It imports the real
// client so the header set is the one production uses — probing with different
// headers would answer a different question.

import { nbaStatsJson, NbaApiError } from "../src/services/nba-api/client";
import { CURRENT_SEASON } from "../src/utils/season";

/** Shorter than the client's 60s default: a declined request burns the lot. */
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 45_000);

type Probe = {
  /** Why this endpoint is in the probe and not another. */
  note: string;
  endpoint: string;
  params: Record<string, string>;
  /** Pulls the row count out of whichever envelope this endpoint uses. */
  count: (body: any) => number;
};

const PROBES: Probe[] = [
  {
    note: "the season's game logs — the call the whole pipeline is built on",
    endpoint: "playergamelogs",
    params: { LeagueID: "00", Season: CURRENT_SEASON, SeasonType: "Regular Season" },
    count: (b) => b?.resultSets?.[0]?.rowSet?.length ?? 0,
  },
  {
    note: "a v3 endpoint — different envelope, possibly different treatment",
    endpoint: "scoreboardv3",
    params: { GameDate: isoYesterday(), LeagueID: "00" },
    count: (b) => b?.scoreboard?.games?.length ?? 0,
  },
];

function isoYesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log(`probing stats.nba.com  ·  ${new Date().toISOString()}`);
  console.log(`timeout ${TIMEOUT_MS / 1000}s per call, season ${CURRENT_SEASON}\n`);

  let failures = 0;

  for (const p of PROBES) {
    console.log(`${p.endpoint}`);
    console.log(`  (${p.note})`);
    const started = Date.now();

    try {
      const body = await nbaStatsJson<any>(p.endpoint, p.params, TIMEOUT_MS);
      const ms = Date.now() - started;
      const rows = p.count(body);

      // A 200 carrying no rows is still an answer: the address is not the
      // problem. Worth separating from a timeout, which is the finding.
      console.log(`  OK    ${ms}ms, ${rows} rows\n`);
    } catch (err) {
      const ms = Date.now() - started;
      failures++;
      const timedOut = err instanceof NbaApiError && /did not respond/.test(err.message);
      console.log(`  FAIL  ${ms}ms — ${timedOut ? "TIMED OUT (silence, the signature of a decline)" : String(err)}\n`);
    }
  }

  console.log("─".repeat(70));
  if (failures === 0) {
    console.log("stats.nba.com answered from this machine.");
    console.log("Pair this with the run from the other machine before concluding.");
  } else {
    console.log(`${failures} of ${PROBES.length} endpoints did not answer from this machine.`);
    console.log("On its own this is NOT evidence of an address block — run the");
    console.log("control on the other machine within a few minutes and compare.");
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`the probe itself broke, which is not a result: ${err}`);
  process.exit(2);
});
