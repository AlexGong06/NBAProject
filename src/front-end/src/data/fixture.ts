// Offline data source: the whole 2025-26 season, top 25 per date, exported from
// the database and committed as public/rankings.json. 164 game dates, 4,100
// rows, 78 players — enough to run the app with no database at all.
//
// This used to be a simulation — eight hand-written players and a sine wave
// that faked day-to-day movement. It is real data now: real stats and real
// availability, computed from NBA stats API game logs, with the ten days the
// NBA played no games carrying no rows.
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
