import { describe, expect, it } from "vitest";
import { headshotUrl, playerIdOf } from "./headshot";

describe("recovering a player id", () => {
  it("uses playerId when the source supplies it", () => {
    expect(playerIdOf({ playerId: 1628983 })).toBe(1628983);
  });

  // The committed fixture drops playerId but keeps profileUrl, so this path is
  // the only one that works offline — and it is the one that would rot silently
  // if the URL format ever changed, since a missing photo looks like a player
  // without a headshot rather than like a bug.
  it("recovers the id from a profile URL when playerId is absent", () => {
    expect(
      playerIdOf({
        profileUrl: "https://www.nba.com/player/1628983/shai-gilgeous-alexander",
      }),
    ).toBe(1628983);
  });

  // build-season.ts emits this shorter form for anyone whose bio had no slug.
  it("handles a profile URL with no name slug", () => {
    expect(playerIdOf({ profileUrl: "https://www.nba.com/player/203999" })).toBe(203999);
  });

  it("prefers playerId over the URL", () => {
    expect(
      playerIdOf({ playerId: 203999, profileUrl: "https://www.nba.com/player/1628983/x" }),
    ).toBe(203999);
  });

  it("returns null when there is nothing to read", () => {
    expect(playerIdOf({})).toBeNull();
    expect(playerIdOf({ profileUrl: "https://www.nba.com/player/" })).toBeNull();
    expect(playerIdOf({ profileUrl: "not a url" })).toBeNull();
  });

  // A zero or negative id would build a URL that 404s. Better to fall back to
  // initials than to fire a request that cannot succeed.
  it("rejects ids that cannot be real", () => {
    expect(playerIdOf({ playerId: 0 })).toBeNull();
    expect(playerIdOf({ playerId: -1 })).toBeNull();
    expect(playerIdOf({ playerId: 1.5 })).toBeNull();
  });
});

describe("building the headshot URL", () => {
  it("points at the CDN size the avatars actually need", () => {
    expect(headshotUrl({ playerId: 1626166 })).toBe(
      "https://cdn.nba.com/headshots/nba/latest/260x190/1626166.png",
    );
  });

  it("is null when no id can be recovered, so no request is made", () => {
    expect(headshotUrl({})).toBeNull();
  });
});
