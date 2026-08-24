// Poster frames for the highlight player.
//
// Same arrangement as headshot.ts and team-logo.ts: YouTube serves every video's
// thumbnail from a predictable path keyed by the video id, so nothing is stored
// and no API call is made — the id we already hold is enough.
//
//   https://i.ytimg.com/vi/rVcPtZEdRg4/maxresdefault.jpg
//
// This costs no quota. The Data API quota covers googleapis.com calls; image
// requests to i.ytimg.com are just images.

/**
 * Two sizes, in the order to try them.
 *
 * `maxresdefault` is 1280x720 — 16:9, which is the shape of the well it fills.
 * It is generated from the source upload and does not exist for every video,
 * so `hqdefault` is the fallback: always present, but 480x360, meaning a 4:3
 * frame that has to be cropped to fit.
 */
export const THUMBNAIL_SIZES = ["maxresdefault", "hqdefault"] as const;

export function videoThumbnailUrl(
  videoId: string | null | undefined,
  size: (typeof THUMBNAIL_SIZES)[number] = "maxresdefault",
): string | null {
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  return `https://i.ytimg.com/vi/${videoId}/${size}.jpg`;
}
