import type { PreviewResult, SpotifyTrack } from "@/types";
import { sleep } from "./utils";

/* iTunes Search API preview resolver.
 *
 * SEARCH-PRIMARY by design: the `lookup?isrc=` endpoint is dead (returns 0 for
 * every ISRC, verified), so name+artist search carries the ~96% match rate.
 * CORS is fine — iTunes is called directly from the browser, no proxy. */

const cache = new Map<string, PreviewResult>();

function cleanTitle(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(
      /\s*-\s*(remaster|remastered|live|mono|stereo|radio edit|single version|deluxe|bonus|feat).*$/i,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

async function itunesSearch(term: string): Promise<string | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    term,
  )}&entity=song&limit=1`;
  const res = await fetch(url);
  const data = await res.json();
  return data.resultCount > 0 && data.results[0].previewUrl
    ? (data.results[0].previewUrl as string)
    : null;
}

/** One retry with light backoff absorbs iTunes' occasional transient failures. */
async function searchWithRetry(term: string): Promise<string | null> {
  try {
    return await itunesSearch(term);
  } catch {
    await sleep(400);
    try {
      return await itunesSearch(term);
    } catch (e) {
      throw e;
    }
  }
}

export async function resolvePreview(
  track: SpotifyTrack,
): Promise<PreviewResult> {
  const cached = cache.get(track.id);
  if (cached) return cached;

  const artist = track.artists[0]?.name ?? "";
  let result: PreviewResult;
  try {
    let url = await searchWithRetry(`${artist} ${track.name}`);
    if (!url) {
      const cleaned = cleanTitle(track.name);
      if (cleaned && cleaned !== track.name) {
        url = await searchWithRetry(`${artist} ${cleaned}`);
      }
    }
    result = url ? { url, via: "search" } : { url: null, via: null };
  } catch (e) {
    result = { url: null, via: null, error: String(e) };
  }

  // only cache successful/definite results (let transient errors re-resolve)
  if (!result.error) cache.set(track.id, result);
  return result;
}
