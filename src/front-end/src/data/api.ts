// Live data source: the same shape, read from the Express API.
//
//   GET /daily-mvp-rankings          every record across all dates
//   GET /daily-mvp-rankings/:date    one date, 404 when no scrape ran
//
// The whole window is fetched once and indexed in memory, so the component tree
// stays synchronous and identical to the fixture path.

import { buildDataSource } from "./build-source";
import type { DataSource, StoredRow } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

export async function loadApiSource(): Promise<DataSource> {
  const res = await fetch(`${API_BASE}/daily-mvp-rankings`);
  if (!res.ok) throw new Error(`GET /daily-mvp-rankings failed: ${res.status}`);
  const rows: StoredRow[] = await res.json();
  return buildDataSource(rows, "The API");
}
