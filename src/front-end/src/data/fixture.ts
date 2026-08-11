// Offline data source: a real 30-day window exported from the production
// database, committed as public/rankings.json.
//
// This used to be a simulation — eight hand-written players and a sine wave
// that faked day-to-day movement. It is now genuine scraped data: real stats,
// real availability recovered from Basketball Reference game logs, and the days
// the collector actually failed, left as gaps.
//
// Nothing here computes anything. Regenerate with `pnpm generate-fixture`.

import { buildDataSource } from "./build-source";
import type { DataSource, StoredRow } from "./types";

export async function loadFixtureSource(): Promise<DataSource> {
  // BASE_URL so this still resolves if the app is served from a subpath.
  const url = `${import.meta.env.BASE_URL}rankings.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Could not load ${url} (${res.status}). Regenerate it with ` +
        `\`pnpm generate-fixture\` from the project root.`,
    );
  }
  const rows: StoredRow[] = await res.json();
  return buildDataSource(rows, "The bundled fixture");
}
