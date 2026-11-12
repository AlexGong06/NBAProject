// A per-season cache that serves instantly, notices new data, and never makes a
// request wait for a rebuild.
//
// ── Why this exists ────────────────────────────────────────────────────────────
//
// Two of this API's answers are expensive to assemble and cheap to reuse: the
// last-game index (3.0s, a join over 26,638 logs) and the rank series (6.4s for
// 2026-27, measured; 184 indexed queries). Both were originally cached for the
// process lifetime, which is correct for a finished season and wrong for one
// still being played — `pnpm build-season --apply` writes last night's games and
// the API goes on serving the previous build until the process restarts.
//
// On Render's free tier that bug hid behind the free tier's own behaviour: the
// service spins down after 15 minutes idle, so the process restarted constantly
// and the caches were never old enough to notice. Paying to keep the instance
// warm removes the spin-down and therefore removes the accidental cure — which
// is exactly the kind of fix that makes a latent bug permanent.
//
// ── The shape of the answer ───────────────────────────────────────────────────
//
// Checking is cheap; rebuilding is not. So the two are separated:
//
//   * every `ttlMs`, and only when a request arrives, compare a small
//     fingerprint of the stored rows against the one the cached value was built
//     from — two indexed counts, single-digit milliseconds;
//   * rebuild only when that fingerprint actually changed.
//
// Nothing blocks on either step. A stale value is served while the check and any
// rebuild happen behind it (stale-while-revalidate), so the 6.4s is paid once
// per process by whoever asks first — and `warmSeasonCaches` arranges for that
// to be the server itself at boot rather than a visitor.
//
// This deliberately does not try to detect a formula change that leaves the row
// count identical. Such a change ships as code, and a deploy replaces the
// process.

import logger from "../utils/logger";

/** What a build produced, and the fingerprint it was built from. */
type Loaded<T> = { data: T; version: string };

type Entry<T> = {
  /**
   * Resolved or resolving, and once resolved never replaced by a rejection —
   * so every caller after the first is served a value, not an error.
   */
  loaded: Promise<Loaded<T>>;
  /** When the fingerprint was last compared against the database. */
  checkedAt: number;
  /** A background check is already in flight; a second would be duplicate work. */
  refreshing: boolean;
};

export type SeasonCache<T> = {
  /** The cached value for a season, building it on first use. */
  get(season: string): Promise<T>;
  /** Build it now, ignoring the TTL. Resolves when it is in place. */
  warm(season: string): Promise<void>;
  /** Drop everything. Tests only — a live process has no reason to. */
  reset(): void;
};

export type SeasonCacheOptions<T> = {
  /** Named in log lines, so a rebuild in production says which cache rebuilt. */
  label: string;
  /**
   * A cheap fingerprint of the rows `build` would read. Compared as an opaque
   * string: any change means rebuild. Must be cheap enough to run on a request,
   * because it does.
   */
  version: (season: string) => Promise<string>;
  build: (season: string) => Promise<T>;
  /** How often to re-check the fingerprint. Default 5 minutes. */
  ttlMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
};

const DEFAULT_TTL_MS = 5 * 60_000;

export function seasonCache<T>(opts: SeasonCacheOptions<T>): SeasonCache<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, Entry<T>>();

  // The fingerprint is read BEFORE the rows, never after. Reading it after
  // would stamp a value that was assembled mid-write with the fingerprint of
  // the finished write, and the cache would then believe itself current while
  // holding a torn read — a staleness bug that no later check can detect.
  async function load(season: string): Promise<Loaded<T>> {
    const version = await opts.version(season);
    const data = await opts.build(season);
    return { data, version };
  }

  function start(season: string): Entry<T> {
    const entry: Entry<T> = {
      loaded: load(season),
      checkedAt: now(),
      refreshing: false,
    };
    entries.set(season, entry);
    // A failed first build must not be cached, or one transient error leaves
    // this season broken for the life of the process. Guarded on identity so a
    // late rejection cannot evict a newer entry.
    entry.loaded.catch(() => {
      if (entries.get(season) === entry) entries.delete(season);
    });
    return entry;
  }

  async function refresh(season: string, entry: Entry<T>): Promise<void> {
    entry.refreshing = true;
    // Stamped before the work, not after: a check that throws then backs off a
    // full TTL instead of being retried on every request while it keeps
    // throwing.
    entry.checkedAt = now();
    try {
      const current = await entry.loaded;
      const version = await opts.version(season);
      if (version === current.version) return;

      const next = await load(season);
      // Swapped only on success, and only if this entry is still the live one.
      // A failed rebuild leaves the previous value in place: stale data still
      // draws a board, an exception draws a 500.
      if (entries.get(season) !== entry) return;
      entry.loaded = Promise.resolve(next);
      logger.info(
        `${opts.label}: ${season} rebuilt (${current.version} -> ${next.version})`,
      );
    } catch (err) {
      logger.error(
        { err },
        `${opts.label}: ${season} refresh failed, serving the previous build`,
      );
    } finally {
      entry.refreshing = false;
    }
  }

  async function get(season: string): Promise<T> {
    const entry = entries.get(season);
    if (!entry) return (await start(season).loaded).data;

    if (!entry.refreshing && now() - entry.checkedAt >= ttlMs) {
      // Deliberately not awaited: the point is that the caller does not wait.
      void refresh(season, entry);
    }
    return (await entry.loaded).data;
  }

  return {
    get,
    async warm(season: string): Promise<void> {
      await get(season);
    },
    reset(): void {
      entries.clear();
    },
  };
}
