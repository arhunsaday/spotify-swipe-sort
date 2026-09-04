import type {
  ListStamp,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyUser,
} from "@/types";
import { spotifyFetch } from "./client";
import { chunk } from "@/lib/utils";

interface Paged<T> {
  items: T[];
  next: string | null;
  total: number;
}

export const LIKED_SOURCE_ID = "__liked__";
export const isLikedId = (id: string | null | undefined) =>
  id === LIKED_SOURCE_ID;

/* Page sizes and write batch sizes are per-endpoint API maximums. */
const PLAYLIST_PAGE = 100; // GET /playlists/{id}/tracks
const SAVED_PAGE = 50; // GET /me/tracks
const PLAYLIST_WRITE = 100; // POST/DELETE /playlists/{id}/tracks
const SAVED_WRITE = 50; // PUT/DELETE /me/tracks

/** Largest batch a single write to this target may carry. */
export const writeBatchSize = (targetId: string) =>
  isLikedId(targetId) ? SAVED_WRITE : PLAYLIST_WRITE;

/* `fields` keeps only what the UI actually reads. Without it every track
 * carries `available_markets` (~180 country codes, twice — track and album),
 * which is roughly 4x the bytes of everything we use. `external_ids` has to be
 * named explicitly or the filter drops it. */
const TRACK_FIELDS =
  "total,next,items(track(id,uri,name,duration_ms,artists(id,name),album(name,images),external_ids))";
const ID_FIELDS = "total,next,items(track(id))";

const uriFor = (trackId: string) => `spotify:track:${trackId}`;

/** Cooperative cancellation: pass a predicate that goes false when the caller
 *  no longer wants the result (source switched, component unmounted). */
export interface PageOpts {
  /** called after each page lands, with everything fetched so far */
  onPage?: (soFar: SpotifyTrack[], total: number) => void;
  onProgress?: (loaded: number, total: number) => void;
  alive?: () => boolean;
}

export async function getMe(): Promise<SpotifyUser> {
  return spotifyFetch<SpotifyUser>("/me");
}

/** All of the user's playlists (follows pagination).
 *  Each item carries `snapshot_id` + `tracks.total`, which doubles as a free
 *  cache stamp for every playlist — see `stampFromPlaylist`. */
export async function getMyPlaylists(): Promise<SpotifyPlaylist[]> {
  const out: SpotifyPlaylist[] = [];
  let url: string | null = "/me/playlists?limit=50";
  while (url) {
    const page: Paged<SpotifyPlaylist> = await spotifyFetch<
      Paged<SpotifyPlaylist>
    >(url);
    out.push(...(page.items || []).filter(Boolean));
    url = page.next;
  }
  return out;
}

interface TrackItem {
  track: SpotifyTrack | null;
}

/* ------------------------------------------------------------------ stamps */

export function stampFromPlaylist(p: SpotifyPlaylist): ListStamp {
  return {
    snapshot: p.snapshot_id ?? null,
    total: p.tracks?.total ?? 0,
    firstId: null,
  };
}

async function getPlaylistStamp(playlistId: string): Promise<ListStamp> {
  const p = await spotifyFetch<{
    snapshot_id: string;
    tracks?: { total: number };
  }>(`/playlists/${playlistId}?fields=snapshot_id,tracks(total)`);
  return {
    snapshot: p.snapshot_id ?? null,
    total: p.tracks?.total ?? 0,
    firstId: null,
  };
}

/** Liked Songs has no snapshot, so the stamp is `total` + the newest saved
 *  track id — an add-then-remove that leaves `total` unchanged still moves it. */
async function getLikedStamp(): Promise<ListStamp> {
  const p = await spotifyFetch<Paged<TrackItem>>("/me/tracks?limit=1");
  return {
    snapshot: null,
    total: p.total ?? 0,
    firstId: p.items?.[0]?.track?.id ?? null,
  };
}

/** One request that tells us whether a cached copy of this list is still good. */
export function getStamp(id: string): Promise<ListStamp> {
  return isLikedId(id) ? getLikedStamp() : getPlaylistStamp(id);
}

/* ------------------------------------------------------------------- reads */

async function pageTracks(
  first: string,
  opts: PageOpts,
): Promise<{ tracks: SpotifyTrack[]; total: number }> {
  const out: SpotifyTrack[] = [];
  let url: string | null = first;
  let total = 0;
  let loaded = 0;
  while (url) {
    const page: Paged<TrackItem> = await spotifyFetch<Paged<TrackItem>>(url);
    if (opts.alive && !opts.alive()) break;
    total = page.total ?? total;
    // local files and unavailable entries come back as null / id-less
    for (const it of page.items || []) {
      if (it.track && it.track.id) out.push(it.track);
    }
    loaded += (page.items || []).length;
    opts.onProgress?.(Math.min(loaded, total || loaded), total);
    opts.onPage?.(out, total);
    url = page.next;
  }
  return { tracks: out, total };
}

/** Every track in a source, no cap. Pages stream through `onPage` so a large
 *  playlist is usable long before the last page lands. */
export function getSourceTracks(
  sourceId: string,
  opts: PageOpts = {},
): Promise<{ tracks: SpotifyTrack[]; total: number }> {
  return isLikedId(sourceId)
    ? pageTracks(`/me/tracks?limit=${SAVED_PAGE}`, opts)
    : pageTracks(
        `/playlists/${sourceId}/tracks?limit=${PLAYLIST_PAGE}&fields=${TRACK_FIELDS}`,
        opts,
      );
}

/** Track ids in a target — powers toggles, dupe detection and `onlyUnfiled`. */
export async function getTargetTrackIds(
  targetId: string,
  alive?: () => boolean,
): Promise<string[]> {
  const ids: string[] = [];
  let url: string | null = isLikedId(targetId)
    ? `/me/tracks?limit=${SAVED_PAGE}`
    : `/playlists/${targetId}/tracks?limit=${PLAYLIST_PAGE}&fields=${ID_FIELDS}`;
  while (url) {
    const page: Paged<TrackItem> = await spotifyFetch<Paged<TrackItem>>(url);
    if (alive && !alive()) break;
    for (const it of page.items || []) if (it.track?.id) ids.push(it.track.id);
    url = page.next;
  }
  return ids;
}

/* ------------------------------------------------------------------ writes */

/** Add tracks to a playlist or to Liked Songs.
 *  Returns the playlist's new `snapshot_id` (null for Liked) so the caller can
 *  keep its cached copy valid instead of invalidating it. */
export async function addTracksToTarget(
  targetId: string,
  trackIds: string[],
): Promise<string | null> {
  if (trackIds.length === 0) return null;
  if (isLikedId(targetId)) {
    for (const part of chunk(trackIds, SAVED_WRITE)) {
      await spotifyFetch(`/me/tracks?ids=${part.join(",")}`, { method: "PUT" });
    }
    return null;
  }
  let snapshot: string | null = null;
  for (const part of chunk(trackIds, PLAYLIST_WRITE)) {
    const res = await spotifyFetch<{ snapshot_id?: string }>(
      `/playlists/${targetId}/tracks`,
      { method: "POST", body: JSON.stringify({ uris: part.map(uriFor) }) },
    );
    snapshot = res?.snapshot_id ?? null;
  }
  return snapshot;
}

export async function removeTracksFromTarget(
  targetId: string,
  trackIds: string[],
): Promise<string | null> {
  if (trackIds.length === 0) return null;
  if (isLikedId(targetId)) {
    for (const part of chunk(trackIds, SAVED_WRITE)) {
      await spotifyFetch(`/me/tracks?ids=${part.join(",")}`, {
        method: "DELETE",
      });
    }
    return null;
  }
  let snapshot: string | null = null;
  for (const part of chunk(trackIds, PLAYLIST_WRITE)) {
    const res = await spotifyFetch<{ snapshot_id?: string }>(
      `/playlists/${targetId}/tracks`,
      {
        method: "DELETE",
        body: JSON.stringify({ tracks: part.map((id) => ({ uri: uriFor(id) })) }),
      },
    );
    snapshot = res?.snapshot_id ?? null;
  }
  return snapshot;
}
