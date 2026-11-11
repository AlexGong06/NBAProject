// Maps each game to its highlight reel on YouTube.
//
//   pnpm resolve-highlights            dry run — pages, matches, reports, writes nothing
//   pnpm resolve-highlights --apply    writes PlayerGameHighlights
//
// Stores a video id, not a video — eleven characters per game. YouTube hosts
// the footage; the browser talks to it directly on play.
//
// Matching a title to a game is inference, so it happens here rather than at
// request time: once, inspectable, and fixable by hand (scripts/add-highlight.ts)
// instead of re-decided on every page view against a quota.
//
// The source is one curated playlist, not the channel uploads or a per-game
// search — search.list allows 100 calls/day, which would take two weeks for
// 1,230 games. This playlist is 28 pages, every item a full-game reel.

import { writeFileSync } from "fs";
import { join } from "path";
import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";
import {
  formatDuration,
  parseHighlightTitle,
} from "../src/services/youtube/highlight-title";
import {
  CURRENT_SEASON,
  isKnownSeason,
  seasonCollections,
} from "../src/utils/season";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const SEASON = CURRENT_SEASON;
const SUMMARIES = seasonCollections(SEASON).summaries;
const HIGHLIGHTS = "PlayerGameHighlights";

/**
 * The NBA's own "Nightly Full Game Highlights" playlist, per season.
 *
 * One id per season, and there is no way to derive the next one — the NBA mints
 * a fresh playlist each year with an opaque id. So a season absent from this
 * map is a refusal rather than a fallback: running against last season's
 * playlist would match nothing, write 1,230 rows of `videoId: null`, and those
 * nulls are what tells the app to STOP looking. A wrong answer here is
 * permanent in a way a missing one is not.
 *
 * To add a season: open the NBA channel's playlists, find "Nightly Full Game
 * Highlights | <season> Season", and copy the `list=` parameter — the whole of
 * it, and nothing else. A YouTube URL for a video *inside* a playlist looks
 * like `watch?v=<videoId>&list=<playlistId>`, so copying the tail of the
 * address bar brings a video id along with it and usually clips the playlist id
 * short. `assertPlaylistIds` below rejects that shape on sight.
 *
 * Keys are season labels — "2026-27", not "2026-2027". A key that is not a
 * label this app serves can never be looked up, so it is rejected too rather
 * than sitting here looking configured.
 */
const SEASON_PLAYLISTS: Record<string, string> = {
  "2025-26": "PLlVlyGVtvuVlek5UOvwJaRDtuAI1FgGZf",
  "2026-27": "PLftRqjkDhxkg",
};

/**
 * The shape of a playlist id — a prefix and then id characters, nothing else.
 *
 * Deliberately NOT length-checked. Playlist ids are not a fixed width: the
 * NBA's 2025-26 playlist is `PLlVlyGVtvuVlek5UOvwJaRDtuAI1FgGZf` (34) and its
 * 2026-27 one is `PLftRqjkDhxkg` (13). A 34-character rule written from the
 * first of those rejected the second, which was a correct id — the check was
 * measuring the wrong property confidently.
 *
 * What this catches is the paste that is not an id at all: a watch URL, or the
 * tail of an address bar. Whether an id points at the RIGHT playlist is a
 * question only YouTube can answer — see `assertPlaylistIsForSeason`.
 */
const PLAYLIST_ID_PATTERN = /^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]+$/;

/**
 * Reject anything that is not an id, before a request is made.
 *
 * Checked for all seasons rather than just the one being run: a bad entry for
 * next season is worth hearing about now, while this file is open.
 */
function assertPlaylistIds(): void {
  for (const [season, id] of Object.entries(SEASON_PLAYLISTS)) {
    if (!isKnownSeason(season)) {
      throw new Error(
        `SEASON_PLAYLISTS has a key "${season}", which is not a season this ` +
          `app serves. Season labels are two consecutive years — "2026-27", ` +
          `not "2026-2027". Nothing would ever look this entry up.`,
      );
    }
    if (PLAYLIST_ID_PATTERN.test(id)) continue;

    const fromUrl = /list=([A-Za-z0-9_-]+)/.exec(id);
    throw new Error(
      `SEASON_PLAYLISTS["${season}"] = "${id}" is not a playlist id — ` +
        (fromUrl
          ? `it looks like part of a watch URL. The id is the \`list=\` value ` +
            `alone, here "${fromUrl[1]}".`
          : `ids start with PL (or UU/LL/FL/RD/OL) and contain only letters, ` +
            `digits, "-" and "_".`) +
        `\n  Open the playlist itself and copy the \`list=\` value from:\n  ` +
        `  https://www.youtube.com/playlist?list=<id>`,
    );
  }
}

/**
 * Confirm the playlist is the one for this season, by its title.
 *
 * This is the check the length rule was pretending to be. A syntactically fine
 * id for the WRONG playlist is the genuinely dangerous input: it pages
 * successfully, matches nothing, and — but for the 90% gate below — would
 * write `videoId: null` for every game, which the app reads as "already
 * looked, nothing there". One request, one quota unit, before any of that.
 */
async function assertPlaylistIsForSeason(): Promise<void> {
  const body = await youtube<{
    items?: { snippet: { title: string; channelTitle: string } }[];
  }>("playlists", { part: "snippet", id: PLAYLIST_ID });

  const found = body.items?.[0];
  if (!found) {
    throw new Error(
      `YouTube has no playlist "${PLAYLIST_ID}" (recorded for ${SEASON}). ` +
        `Check the \`list=\` value on the playlist's own page.`,
    );
  }

  // The season as the NBA writes it in the title: "2026-27".
  if (!found.snippet.title.includes(SEASON)) {
    throw new Error(
      `SEASON_PLAYLISTS["${SEASON}"] points at "${found.snippet.title}" ` +
        `(${found.snippet.channelTitle}), which does not name ${SEASON}. ` +
        `Running on another season's playlist would match no games and store ` +
        `a null video id for all of them.`,
    );
  }

  logger.info(`playlist ${PLAYLIST_ID}: "${found.snippet.title}"`);
}

const PLAYLIST_ID = (() => {
  assertPlaylistIds();

  const id = SEASON_PLAYLISTS[SEASON];
  if (!id) {
    throw new Error(
      `No highlights playlist recorded for ${SEASON}. Find "Nightly Full Game ` +
        `Highlights | ${SEASON} Season" on the NBA's YouTube channel and add ` +
        `its id to SEASON_PLAYLISTS in this file.\n  ` +
        `Running against another season's playlist would store a null video ` +
        `id for every game, which the app reads as "already looked, nothing ` +
        `there".`,
    );
  }
  return id;
})();

const API = "https://www.googleapis.com/youtube/v3";

/** Where the unmatched games are written, for filling in by hand. */
const REPORT_PATH = join(__dirname, "..", "missing-highlights.txt");

type PlaylistItem = {
  snippet: { title: string };
  contentDetails: { videoId: string };
};

type HighlightRow = {
  _id: string;
  gameId: string;
  videoId: string | null;
  title: string | null;
  channel: string;
  durationLabel: string;
  resolvedAt: Date;
  source: "playlist" | "manual";
};

async function youtube<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      "Missing YOUTUBE_API_KEY. Create one at console.cloud.google.com with the " +
        "YouTube Data API v3 enabled, and add it to .env.",
    );
  }

  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetch(url);
  const body = await res.json();

  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? res.status;
    // The two failures worth naming, because both look like "it is broken".
    const hint =
      reason === "quotaExceeded"
        ? " — the daily quota is spent; it resets at midnight Pacific."
        : reason === "accessNotConfigured"
          ? " — the key exists but YouTube Data API v3 is not enabled on its project."
          : "";
    throw new Error(`YouTube ${path} failed: ${reason}${hint}`);
  }

  return body as T;
}

/** Every video on the playlist, newest first. 50 per request. */
async function pagePlaylist(): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken = "";
  let requests = 0;

  do {
    const body = await youtube<{
      items: PlaylistItem[];
      nextPageToken?: string;
    }>("playlistItems", {
      part: "snippet,contentDetails",
      maxResults: "50",
      playlistId: PLAYLIST_ID,
      ...(pageToken ? { pageToken } : {}),
    });
    items.push(...body.items);
    pageToken = body.nextPageToken ?? "";
    requests++;
  } while (pageToken);

  logger.info(
    `paged the playlist: ${items.length} videos in ${requests} requests`,
  );
  return items;
}

/** Durations for the matched videos, 50 ids per request. */
async function fetchDurations(
  videoIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  for (let i = 0; i < videoIds.length; i += 50) {
    const body = await youtube<{
      items: { id: string; contentDetails: { duration: string } }[];
    }>("videos", {
      part: "contentDetails",
      id: videoIds.slice(i, i + 50).join(","),
    });

    for (const v of body.items)
      out.set(v.id, formatDuration(v.contentDetails.duration));
  }

  logger.info(
    `fetched ${out.size} durations in ${Math.ceil(videoIds.length / 50)} requests`,
  );
  return out;
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  await assertPlaylistIsForSeason();

  const items = await pagePlaylist();

  // Keyed by the fixture, which is what a game is: two teams on a night. The
  // away side comes first because that is the order the titles use, and it
  // means a reversed fixture cannot match by accident.
  const byFixture = new Map<string, { videoId: string; title: string }>();
  let rejected = 0;

  for (const item of items) {
    const parsed = parseHighlightTitle(item.snippet.title);
    if (!parsed) {
      rejected++;
      continue;
    }
    const key = `${parsed.isoDate}:${parsed.awayAbbr}:${parsed.homeAbbr}`;
    // First wins. The playlist runs newest first, and a game with two entries
    // is a re-upload of the same footage.
    if (!byFixture.has(key)) {
      byFixture.set(key, {
        videoId: item.contentDetails.videoId,
        title: item.snippet.title.trim(),
      });
    }
  }

  logger.info(
    `${byFixture.size} titles parsed into a fixture, ${rejected} not full-game reels`,
  );

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("NbaDb");

    const games = await db
      .collection(SUMMARIES)
      .find({})
      .sort({ isoDate: 1 })
      .toArray();
    if (games.length === 0) {
      throw new Error(
        `${SUMMARIES} is empty — run \`pnpm fetch-summaries --apply\` first.`,
      );
    }

    // Hand-corrected rows are the one thing a re-run must not touch. Everything
    // else is derived and can be rebuilt; these were typed by a person.
    //
    // Scoped to THIS season's games. `PlayerGameHighlights` is one collection
    // across every season — a game id is already unique — so an unscoped query
    // returns last season's manual entries too. They were never going to be
    // overwritten (the loop below only visits this season's games), but they
    // were being counted: `matched + missing + manual` came to 166 against 154
    // games, and the accounting gate correctly refused the run.
    const manual = new Set<string>(
      await db.collection(HIGHLIGHTS).distinct("gameId", {
        source: "manual",
        gameId: { $in: games.map((g: any) => g.gameId) },
      }),
    );

    const matched: HighlightRow[] = [];
    const missing: typeof games = [];

    for (const game of games) {
      if (manual.has(game.gameId)) continue;

      const hit = byFixture.get(
        `${game.isoDate}:${game.awayAbbr}:${game.homeAbbr}`,
      );
      if (!hit) {
        missing.push(game);
        continue;
      }
      matched.push({
        _id: game.gameId,
        gameId: game.gameId,
        videoId: hit.videoId,
        title: hit.title,
        channel: "NBA",
        durationLabel: "",
        resolvedAt: new Date(),
        source: "playlist",
      });
    }

    const durations = await fetchDurations(matched.map((m) => m.videoId!));
    for (const row of matched)
      row.durationLabel = durations.get(row.videoId!) ?? "";

    // A miss is a real answer, stored as one. Without a row, every page view for
    // these games looks like a cache miss worth retrying — and a retry at
    // request time is how the wrong video gets shown.
    const misses: HighlightRow[] = missing.map((game) => ({
      _id: game.gameId,
      gameId: game.gameId,
      videoId: null,
      title: null,
      channel: "NBA",
      durationLabel: "",
      resolvedAt: new Date(),
      source: "playlist",
    }));

    // ── Report ─────────────────────────────────────────────────────────────
    const total = games.length;
    const pct = ((100 * matched.length) / total).toFixed(1);
    logger.info(`matched ${matched.length}/${total} games (${pct}%)`);
    if (manual.size)
      logger.info(`${manual.size} manual entries left untouched`);
    logger.info(`${missing.length} games have no reel on the playlist`);

    const lines = [
      "Games with no highlight reel on the NBA's",
      `"Nightly Full Game Highlights | ${SEASON} Season" playlist.`,
      "",
      `Generated ${new Date().toISOString()} — ${missing.length} of ${total} games.`,
      "",
      "Add one with:  pnpm add-highlight <gameId> <youtubeVideoId>",
      "",
      "DATE        MATCHUP        GAME ID       SEARCH",
      "".padEnd(78, "-"),
      ...missing.map((g) => {
        const matchup = `${g.awayAbbr} @ ${g.homeAbbr}`;
        const query = encodeURIComponent(
          `NBA ${g.awayAbbr} at ${g.homeAbbr} full game highlights ${g.isoDate}`,
        );
        return (
          `${g.isoDate}  ${matchup.padEnd(13)}  ${g.gameId}  ` +
          `https://www.youtube.com/results?search_query=${query}`
        );
      }),
      "",
    ];
    writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
    logger.info(`wrote the list to ${REPORT_PATH}`);

    const sample = matched[0];
    if (sample)
      logger.info(
        `sample: ${sample.gameId} -> ${sample.videoId} (${sample.durationLabel})`,
      );

    // ── Gates ──────────────────────────────────────────────────────────────
    //
    // A run that suddenly matches far less than the measured 99% means the
    // playlist or the title format moved. Better to stop and look than to
    // overwrite good rows with nulls.
    if (matched.length + missing.length + manual.size !== total) {
      throw new Error(
        "accounting mismatch: matched + missing + manual != total games",
      );
    }
    if (matched.length < total * 0.9) {
      throw new Error(
        `only ${matched.length}/${total} games matched, well below the 99% this ` +
          `measured at. Check the playlist id and the title format before writing.`,
      );
    }

    if (!APPLY) {
      logger.info("dry run — nothing written. Re-run with --apply.");
      return;
    }

    const rows = [...matched, ...misses];
    const ops: AnyBulkWriteOperation[] = rows.map((r) => ({
      replaceOne: {
        filter: { _id: r._id as never },
        replacement: r as never,
        upsert: true,
      },
    }));

    const result = await db
      .collection(HIGHLIGHTS)
      .bulkWrite(ops, { ordered: false });
    logger.info(
      `wrote ${result.upsertedCount + result.matchedCount} rows ` +
        `(${matched.length} with a reel, ${misses.length} without)`,
    );

    await db.collection(HIGHLIGHTS).createIndex({ gameId: 1 });
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
