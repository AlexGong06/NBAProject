// Picks the data source.
//
//   VITE_DATA unset | "fixture"  → bundled 30-day fixture, no database needed
//   VITE_DATA=api                → live Express API (VITE_API_BASE, default :3000)
//
// Fixture is the default so a fresh clone runs with `pnpm install && pnpm dev`.

import { loadFixtureSource } from "./fixture";
import { loadApiSource } from "./api";
import type { DataSource } from "./types";

export type DataMode = "fixture" | "api";

export const DATA_MODE: DataMode =
  import.meta.env.VITE_DATA === "api" ? "api" : "fixture";

/**
 * Load one season.
 *
 * `season` is omitted on first load so the API picks — which is the newest
 * season that actually has data, not whichever one the bundle was built
 * believing in. The picker passes an explicit id after that.
 *
 * The fixture ignores it: it holds one season and says so by reporting no
 * alternatives.
 */
export async function loadDataSource(season?: string): Promise<DataSource> {
  if (DATA_MODE === "api") return loadApiSource(season);
  return loadFixtureSource();
}

export type { DataSource } from "./types";
