import { describe, it, expect } from "vitest";
import { seasonCache } from "./season-cache";

const TTL = 1000;

/** A cache whose clock, fingerprint and build are all under the test's control. */
function harness(ttlMs: number = TTL) {
  const state = {
    /** What `version` reports next, per season. */
    version: new Map<string, string>(),
    /** What `build` returns next, per season. */
    value: new Map<string, string>(),
    versionCalls: [] as string[],
    buildCalls: [] as string[],
    /** Set either to make the corresponding hook throw. */
    failVersion: false,
    failBuild: false,
    /** When set, `build` waits on it — lets a test hold a rebuild open. */
    hold: null as Promise<void> | null,
    /** Interleaving of the two hooks, to pin their order. */
    order: [] as string[],
  };

  let clock = 0;

  const cache = seasonCache<string>({
    label: "test",
    ttlMs,
    now: () => clock,
    version: async (season) => {
      state.versionCalls.push(season);
      state.order.push(`version:${season}`);
      if (state.failVersion) throw new Error("version failed");
      return state.version.get(season) ?? "v1";
    },
    build: async (season) => {
      state.buildCalls.push(season);
      state.order.push(`build:${season}`);
      if (state.failBuild) throw new Error("build failed");
      if (state.hold) await state.hold;
      return state.value.get(season) ?? "data1";
    },
  });

  return {
    cache,
    state,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Let every already-queued microtask and timer callback run. */
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    /** A promise plus its resolver, for `state.hold`. */
    deferred: () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    },
  };
}

describe("seasonCache", () => {
  it("builds once and serves the cached value after that", async () => {
    const { cache, state } = harness();

    expect(await cache.get("2026-27")).toBe("data1");
    expect(await cache.get("2026-27")).toBe("data1");
    expect(await cache.get("2026-27")).toBe("data1");

    expect(state.buildCalls).toEqual(["2026-27"]);
  });

  it("reads the fingerprint before the rows, not after", async () => {
    const { cache, state } = harness();
    await cache.get("2026-27");
    expect(state.order).toEqual(["version:2026-27", "build:2026-27"]);
  });

  it("keeps seasons separate", async () => {
    const { cache, state } = harness();
    state.value.set("2026-27", "new");
    state.value.set("2025-26", "old");

    expect(await cache.get("2026-27")).toBe("new");
    expect(await cache.get("2025-26")).toBe("old");
    expect(state.buildCalls).toEqual(["2026-27", "2025-26"]);
  });

  it("does not touch the database while the entry is fresh", async () => {
    const { cache, state, advance } = harness();
    await cache.get("2026-27");
    state.versionCalls.length = 0;

    advance(TTL - 1);
    await cache.get("2026-27");

    expect(state.versionCalls).toEqual([]);
  });

  it("checks the fingerprint after the TTL, and does not rebuild when it is unchanged", async () => {
    const { cache, state, advance, settle } = harness();
    await cache.get("2026-27");
    state.versionCalls.length = 0;
    state.buildCalls.length = 0;

    advance(TTL);
    expect(await cache.get("2026-27")).toBe("data1");
    await settle();

    expect(state.versionCalls).toEqual(["2026-27"]);
    expect(state.buildCalls).toEqual([]);
  });

  it("rebuilds and swaps in the new value when the fingerprint changed", async () => {
    const { cache, state, advance, settle } = harness();
    await cache.get("2026-27");

    state.version.set("2026-27", "v2");
    state.value.set("2026-27", "data2");

    advance(TTL);
    // Served the old value: the rebuild has only just been kicked off.
    expect(await cache.get("2026-27")).toBe("data1");
    await settle();

    expect(await cache.get("2026-27")).toBe("data2");
  });

  it("serves the stale value without waiting for the rebuild", async () => {
    const { cache, state, advance, settle, deferred } = harness();
    await cache.get("2026-27");

    state.version.set("2026-27", "v2");
    state.value.set("2026-27", "data2");

    // Hold the rebuild open so that returning the old value cannot be a race
    // won by luck — the new build demonstrably has not finished.
    const gate = deferred();
    state.hold = gate.promise;

    advance(TTL);
    expect(await cache.get("2026-27")).toBe("data1");
    expect(await cache.get("2026-27")).toBe("data1");
    expect(state.buildCalls).toEqual(["2026-27", "2026-27"]);

    gate.release();
    state.hold = null;
    await settle();

    expect(await cache.get("2026-27")).toBe("data2");
  });

  it("collapses concurrent first calls into one build", async () => {
    const { cache, state } = harness();

    const all = await Promise.all([
      cache.get("2026-27"),
      cache.get("2026-27"),
      cache.get("2026-27"),
    ]);

    expect(all).toEqual(["data1", "data1", "data1"]);
    expect(state.buildCalls).toEqual(["2026-27"]);
  });

  it("runs only one background refresh at a time", async () => {
    const { cache, state, advance, settle } = harness();
    await cache.get("2026-27");
    state.versionCalls.length = 0;

    advance(TTL);
    await Promise.all([
      cache.get("2026-27"),
      cache.get("2026-27"),
      cache.get("2026-27"),
    ]);
    await settle();

    expect(state.versionCalls).toEqual(["2026-27"]);
  });

  it("does not cache a failed first build", async () => {
    const { cache, state } = harness();
    state.failBuild = true;

    await expect(cache.get("2026-27")).rejects.toThrow("build failed");

    state.failBuild = false;
    expect(await cache.get("2026-27")).toBe("data1");
    expect(state.buildCalls).toEqual(["2026-27", "2026-27"]);
  });

  it("keeps serving the previous build when a rebuild fails", async () => {
    const { cache, state, advance, settle } = harness();
    await cache.get("2026-27");

    state.version.set("2026-27", "v2");
    state.failBuild = true;

    advance(TTL);
    expect(await cache.get("2026-27")).toBe("data1");
    await settle();

    // The rebuild threw. Stale data still draws a board; an exception would
    // have drawn a 500.
    expect(await cache.get("2026-27")).toBe("data1");
  });

  it("backs off a full TTL after a failed check instead of retrying every request", async () => {
    const { cache, state, advance, settle } = harness();
    await cache.get("2026-27");
    state.versionCalls.length = 0;

    state.failVersion = true;
    advance(TTL);
    await cache.get("2026-27");
    await settle();
    expect(state.versionCalls).toHaveLength(1);

    // Still inside the next window, so no second attempt.
    await cache.get("2026-27");
    await cache.get("2026-27");
    await settle();
    expect(state.versionCalls).toHaveLength(1);

    // A full TTL later it tries again, and recovers.
    state.failVersion = false;
    state.version.set("2026-27", "v2");
    state.value.set("2026-27", "data2");
    advance(TTL);
    await cache.get("2026-27");
    await settle();

    // Three, not two: the successful check found a change, and the rebuild it
    // triggered reads the fingerprint again immediately before building, so the
    // value is stamped with what it actually read. Only a real rebuild pays it.
    expect(state.versionCalls).toHaveLength(3);
    expect(await cache.get("2026-27")).toBe("data2");
  });

  it("warm builds the value up front, and get then costs nothing", async () => {
    const { cache, state } = harness();

    await cache.warm("2026-27");
    expect(state.buildCalls).toEqual(["2026-27"]);

    expect(await cache.get("2026-27")).toBe("data1");
    expect(state.buildCalls).toEqual(["2026-27"]);
  });

  it("reset drops the cached value", async () => {
    const { cache, state } = harness();
    await cache.get("2026-27");
    cache.reset();
    await cache.get("2026-27");

    expect(state.buildCalls).toEqual(["2026-27", "2026-27"]);
  });
});
