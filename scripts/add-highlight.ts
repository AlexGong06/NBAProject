// Attaches a highlight reel to a game by hand.
//
//   pnpm add-highlight 0022500195 dQw4w9WgXcQ
//   pnpm add-highlight 0022500195 "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
//
// For the handful of games the NBA never posted to the season playlist —
// `pnpm resolve-highlights` writes them to missing-highlights.txt with a search
// link for each.
//
// Rows written here carry `source: "manual"` and are the one thing a resolver
// re-run will not overwrite. Everything else in this collection is derived and
// can be rebuilt; these were typed by a person and there is no way to recover
// them.

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import logger from "../src/utils/logger";
import { formatDuration } from "../src/services/youtube/highlight-title";

dotenv.config();

const SUMMARIES = "GameSummaries2526";
const HIGHLIGHTS = "PlayerGameHighlights";

/**
 * Accept a bare id or any of the URL shapes someone would paste.
 *
 * A video id is 11 characters of `[A-Za-z0-9_-]`. Pasting a whole watch URL is
 * the obvious thing to do, so it is worth handling rather than rejecting.
 */
function parseVideoId(raw: string): string | null {
  const direct = raw.match(/^[A-Za-z0-9_-]{11}$/);
  if (direct) return raw;

  const url = raw.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return url ? url[1] : null;
}

async function main(): Promise<void> {
  const [gameId, rawVideo] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  if (!gameId || !rawVideo) {
    throw new Error("Usage: pnpm add-highlight <gameId> <youtubeVideoIdOrUrl>");
  }

  const videoId = parseVideoId(rawVideo);
  if (!videoId) {
    throw new Error(
      `"${rawVideo}" is not a YouTube video id or URL. An id is 11 characters, ` +
        `for example dQw4w9WgXcQ.`,
    );
  }

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Missing MONGO_URI");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("NbaDb");

    // Refuse a game id that does not exist rather than storing an orphan row
    // nothing will ever read.
    const game = await db.collection(SUMMARIES).findOne({ gameId });
    if (!game) {
      throw new Error(
        `No game ${gameId}. The id comes from missing-highlights.txt, or from ` +
          `GameSummaries2526.`,
      );
    }

    // Confirm the video exists and is embeddable before storing it. A dead id
    // renders as a broken player, which reads as a bug in the app rather than a
    // bad paste.
    let title = "";
    let durationLabel = "";
    const key = process.env.YOUTUBE_API_KEY;

    if (key) {
      const url =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=snippet,contentDetails,status&id=${videoId}&key=${key}`;
      const res = await fetch(url);
      const body = await res.json();

      if (!res.ok) throw new Error(`YouTube lookup failed: ${body?.error?.message ?? res.status}`);
      if (!body.items?.length) throw new Error(`No YouTube video with id ${videoId}.`);

      const v = body.items[0];
      if (v.status?.embeddable === false) {
        throw new Error(`Video ${videoId} cannot be embedded, so the player would stay blank.`);
      }
      title = v.snippet.title;
      durationLabel = formatDuration(v.contentDetails.duration);
      logger.info(`verified: "${title}" (${durationLabel})`);
    } else {
      logger.warn("No YOUTUBE_API_KEY — storing without verifying the video exists.");
    }

    await db.collection(HIGHLIGHTS).replaceOne(
      { _id: gameId as never },
      {
        _id: gameId,
        gameId,
        videoId,
        title: title || null,
        channel: "NBA",
        durationLabel,
        resolvedAt: new Date(),
        source: "manual",
      } as never,
      { upsert: true },
    );

    logger.info(
      `${game.awayAbbr} @ ${game.homeAbbr} on ${game.isoDate} -> ${videoId} (manual)`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
