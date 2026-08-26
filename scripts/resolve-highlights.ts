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
import { formatDuration, parseHighlightTitle } from "../src/services/youtube/highlight-title";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const SUMMARIES = "GameSummaries2526";
const HIGHLIGHTS = "PlayerGameHighlights";

/** "Nightly Full Game Highlights | 2025-26 Season" on the official NBA channel. */
const PLAYLIST_ID = "PLlVlyGVtvuVlek5UOvwJaRDtuAI1FgGZf";

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

async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
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
    const body = await youtube<{ items: PlaylistItem[]; nextPageToken?: string }>(
      "playlistItems",
      {
        part: "snippet,contentDetails",
        maxResults: "50",
        playlistId: PLAYLIST_ID,
        ...(pageToken ? { pageToken } : {}),
      },
    );
    items.push(...body.items);
    pageToken = body.nextPageToken ?? "";
    requests++;
  } while (pageToken);

  logger.info(`paged the playlist: ${items.length} videos in ${requests} requests`);
  return items;
}

/** Durations for the matched videos, 50 ids per request. */
async function fetchDurations(videoIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  for (let i = 0; i < videoIds.length; i += 50) {
    const body = await youtube<{
      items: { id: string; contentDetails: { duration: string } }[];
    }>("videos", { part: "contentDetails", id: videoIds.slice(i, i + 50).join(",") });

    for (const v of body.items) out.set(v.id, formatDuration(v.contentDetails.duration));
  }

  logger.info(`fetched ${out.size} durations in ${Math.ceil(videoIds.length / 50)} requests`);
  return out;
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

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
      byFixture.set(key, { videoId: item.contentDetails.videoId, title: item.snippet.title.trim() });
    }
  }

  logger.info(`${byFixture.size} titles parsed into a fixture, ${rejected} not full-game reels`);

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("NbaDb");

    const games = await db.collection(SUMMARIES).find({}).sort({ isoDate: 1 }).toArray();
    if (games.length === 0) {
      throw new Error(`${SUMMARIES} is empty — run \`pnpm fetch-summaries --apply\` first.`);
    }

    // Hand-corrected rows are the one thing a re-run must not touch. Everything
    // else is derived and can be rebuilt; these were typed by a person.
    const manual = new Set<string>(
      await db.collection(HIGHLIGHTS).distinct("gameId", { source: "manual" }),
    );

    const matched: HighlightRow[] = [];
    const missing: typeof games = [];

    for (const game of games) {
      if (manual.has(game.gameId)) continue;

      const hit = byFixture.get(`${game.isoDate}:${game.awayAbbr}:${game.homeAbbr}`);
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
    for (const row of matched) row.durationLabel = durations.get(row.videoId!) ?? "";

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
    if (manual.size) logger.info(`${manual.size} manual entries left untouched`);
    logger.info(`${missing.length} games have no reel on the playlist`);

    const lines = [
      "Games with no highlight reel on the NBA's",
      '"Nightly Full Game Highlights | 2025-26 Season" playlist.',
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
    if (sample) logger.info(`sample: ${sample.gameId} -> ${sample.videoId} (${sample.durationLabel})`);

    // ── Gates ──────────────────────────────────────────────────────────────
    //
    // A run that suddenly matches far less than the measured 99% means the
    // playlist or the title format moved. Better to stop and look than to
    // overwrite good rows with nulls.
    if (matched.length + missing.length + manual.size !== total) {
      throw new Error("accounting mismatch: matched + missing + manual != total games");
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
      replaceOne: { filter: { _id: r._id as never }, replacement: r as never, upsert: true },
    }));

    const result = await db.collection(HIGHLIGHTS).bulkWrite(ops, { ordered: false });
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
