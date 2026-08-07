// Picks the data source.
//
//   VITE_DATA unset | "fixture"  → bundled 30-day fixture, no database needed
//   VITE_DATA=api                → live Express API (VITE_API_BASE, default :3000)
//
// Fixture is the default so a fresh clone runs with `pnpm install && pnpm dev`.

import { fixtureSource } from "./fixture";
import { loadApiSource } from "./api";
import type { DataSource } from "./types";

export type DataMode = "fixture" | "api";

export const DATA_MODE: DataMode =
  import.meta.env.VITE_DATA === "api" ? "api" : "fixture";

export async function loadDataSource(): Promise<DataSource> {
  if (DATA_MODE === "api") return loadApiSource();
  return fixtureSource;
}

export type { DataSource } from "./types";
