import type { PreviewResult, PreviewVia, SpotifyTrack } from "@/types";
import { idbGetMany, idbSet } from "./idb";
import { sleep } from "./utils";

/* iTunes Search API preview resolver.
 *
 * SEARCH-PRIMARY by design: the `lookup?isrc=` endpoint is dead (returns 0 for
 * every ISRC, verified), so name+artist search carries the ~96% match rate.
 * CORS is fine — iTunes is called directly from the browser, no proxy.
 *
 * Results are cached in IndexedDB, so a second pass over the same playlist
 * costs zero lookups. Misses are cached too, but expire sooner — a track
 * missing from iTunes today may be there next month. */

const cache = new Map<string, PreviewResult>();
const inflight = new Map<string, Promise<PreviewResult>>();

const STORE_V = 1;
const HIT_TTL = 30 * 24 * 3_600_000; // preview URLs do rot eventually
const MISS_TTL = 7 * 24 * 3_600_000;

interface StoredPreview {
  v: number;
  url: string | null;
  via: PreviewVia;
  at: number;
}

function fresh(s: StoredPreview | null): boolean {
  if (!s || s.v !== STORE_V) return false;
  return Date.now() - s.at < (s.url ? HIT_TTL : MISS_TTL);
}

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
    return itunesSearch(term);
  }
}

/** Pull a window of track ids off disk into memory in one transaction, so the
 *  common case (already resolved in an earlier session) never awaits IO on the
 *  keypress path. */
export async function warmPreviews(trackIds: string[]): Promise<void> {
  const missing = trackIds.filter((id) => id && !cache.has(id));
  if (missing.length === 0) return;
  const rows = await idbGetMany<StoredPreview>("previews", missing);
  rows.forEach((row, i) => {
    if (row && fresh(row)) cache.set(missing[i], { url: row.url, via: row.via });
  });
}

async function resolveUncached(track: SpotifyTrack): Promise<PreviewResult> {
  const [disk] = await idbGetMany<StoredPreview>("previews", [track.id]);
  if (disk && fresh(disk)) {
    const hit: PreviewResult = { url: disk.url, via: disk.via };
    cache.set(track.id, hit);
    return hit;
  }

  const artist = track.artists[0]?.name ?? "";
  try {
    let url = await searchWithRetry(`${artist} ${track.name}`);
    if (!url) {
      const cleaned = cleanTitle(track.name);
      if (cleaned && cleaned !== track.name) {
        url = await searchWithRetry(`${artist} ${cleaned}`);
      }
    }
    const result: PreviewResult = url
      ? { url, via: "search" }
      : { url: null, via: null };
    cache.set(track.id, result);
    void idbSet("previews", track.id, {
      v: STORE_V,
      url: result.url,
      via: result.via,
      at: Date.now(),
    } satisfies StoredPreview);
    return result;
  } catch (e) {
    // transient — don't cache, let it re-resolve
    return { url: null, via: null, error: String(e) };
  }
}

export async function resolvePreview(
  track: SpotifyTrack,
): Promise<PreviewResult> {
  const cached = cache.get(track.id);
  if (cached) return cached;
  const running = inflight.get(track.id);
  if (running) return running;

  const p = resolveUncached(track).finally(() => inflight.delete(track.id));
  inflight.set(track.id, p);
  return p;
}

/** Resolve upcoming tracks in the background so ← / → feels instant.
 *  Serialised on purpose: iTunes is an unauthenticated public endpoint and the
 *  user only needs one of these at a time. */
export async function prefetchPreviews(tracks: SpotifyTrack[]): Promise<void> {
  for (const t of tracks) {
    if (!t || cache.has(t.id) || inflight.has(t.id)) continue;
    try {
      await resolvePreview(t);
    } catch {
      /* best effort */
    }
  }
}
