/* Local cache for everything we'd otherwise re-fetch on every page load.
 *
 * Policy is stale-while-revalidate: a cached copy is painted immediately, then
 * validated with ONE cheap request (`getStamp`) that tells us whether the
 * remote list moved. Only a moved list is re-paged.
 *
 * Validation deliberately isn't snapshot_id alone:
 *   - playlists  → snapshot_id (moves on any edit, including reorder) *and*
 *     track total, so a reused snapshot can't slip through;
 *   - Liked Songs → has no snapshot, so total + the newest saved track id;
 *   - both       → a hard max age, so a bug or an API quirk can never pin a
 *     stale list forever;
 *   - the playlist index → plain TTL, since /me/playlists has no validator.
 *
 * Our own writes patch the cache in place (with the snapshot_id the write
 * returns), so filing tracks doesn't invalidate what we just cached. */

import type { ListStamp, SpotifyPlaylist, SpotifyTrack } from "@/types";
import { isLikedId } from "@/api/spotify";
import { idbClearAll, idbDel, idbGet, idbSet } from "./idb";

/** Bump to discard every cached list after a shape change. */
const CACHE_V = 1;

export interface Entry<T> {
  v: number;
  data: T;
  stamp: ListStamp;
  at: number;
}

/** Just fetched — don't even spend the validation request. */
const TRUST_MS = 45_000;
/** Backstop for the snapshot/total validators. */
const MAX_AGE_PLAYLIST = 7 * 24 * 3_600_000;
const MAX_AGE_LIKED = 24 * 3_600_000;
/** /me/playlists has no cheap validator, so the index gets a plain TTL. */
export const PLAYLISTS_TTL = 10 * 60_000;

const maxAge = (id: string) => (isLikedId(id) ? MAX_AGE_LIKED : MAX_AGE_PLAYLIST);

export const isTrusted = (e: Entry<unknown>) => Date.now() - e.at < TRUST_MS;
export const isUsable = (e: Entry<unknown>, id: string) =>
  e.v === CACHE_V && Date.now() - e.at < maxAge(id);

export function stampsMatch(a: ListStamp, b: ListStamp): boolean {
  return (
    a.total === b.total && a.snapshot === b.snapshot && a.firstId === b.firstId
  );
}

function pack<T>(data: T, stamp: ListStamp): Entry<T> {
  return { v: CACHE_V, data, stamp, at: Date.now() };
}

function unpack<T>(e: Entry<T> | null, id: string): Entry<T> | null {
  return e && isUsable(e, id) ? e : null;
}

/* ------------------------------------------------------ source track lists */

export async function readList(
  sourceId: string,
): Promise<Entry<SpotifyTrack[]> | null> {
  const e = await idbGet<Entry<SpotifyTrack[]>>("lists", sourceId);
  return Array.isArray(e?.data) ? unpack(e, sourceId) : null;
}

export function writeList(
  sourceId: string,
  tracks: SpotifyTrack[],
  stamp: ListStamp,
): Promise<unknown> {
  return idbSet("lists", sourceId, pack(tracks, stamp));
}

/** Forget a cached list — used when we change it in a way we can't replay
 *  locally (a re-add lands at the end, not where the track was). */
export function dropList(sourceId: string): Promise<unknown> {
  return idbDel("lists", sourceId);
}

/** Keep a cached source list correct after we remove tracks from it ourselves
 *  (move mode), so the next load still validates instead of re-paging. */
export async function patchList(
  sourceId: string,
  removedIds: string[],
  snapshot: string | null,
): Promise<void> {
  const e = await idbGet<Entry<SpotifyTrack[]>>("lists", sourceId);
  if (!e || !Array.isArray(e.data)) return;
  const drop = new Set(removedIds);
  const data = e.data.filter((t) => !drop.has(t.id));
  const gone = e.data.length - data.length;
  if (gone === 0 && snapshot === e.stamp.snapshot) return;
  await idbSet("lists", sourceId, {
    ...e,
    data,
    at: Date.now(),
    stamp: {
      snapshot: isLikedId(sourceId) ? null : snapshot,
      total: Math.max(0, e.stamp.total - gone),
      firstId: isLikedId(sourceId) ? (data[0]?.id ?? null) : null,
    },
  });
}

/* --------------------------------------------------------- target contents */

export async function readMembers(
  targetId: string,
): Promise<Entry<string[]> | null> {
  const e = await idbGet<Entry<string[]>>("members", targetId);
  return Array.isArray(e?.data) ? unpack(e, targetId) : null;
}

export function writeMembers(
  targetId: string,
  ids: string[],
  stamp: ListStamp,
): Promise<unknown> {
  return idbSet("members", targetId, pack(ids, stamp));
}

/** Apply our own add/remove to the cached membership + stamp. A wrong guess
 *  here only costs one re-page on the next load — the stamp won't match. */
export async function patchMembers(
  targetId: string,
  added: string[],
  removed: string[],
  snapshot: string | null,
): Promise<void> {
  const e = await idbGet<Entry<string[]>>("members", targetId);
  if (!e || !Array.isArray(e.data)) return;
  const ids = new Set(e.data);
  let delta = 0;
  for (const id of added) {
    if (!ids.has(id)) {
      ids.add(id);
      delta++;
    }
  }
  for (const id of removed) {
    if (ids.delete(id)) delta--;
  }
  const liked = isLikedId(targetId);
  await idbSet("members", targetId, {
    ...e,
    data: [...ids],
    at: Date.now(),
    stamp: {
      snapshot: liked ? null : snapshot,
      total: Math.max(0, e.stamp.total + delta),
      // saves land at the top of Liked Songs, so the last id we added is newest
      firstId: liked
        ? (added[added.length - 1] ?? e.stamp.firstId)
        : null,
    },
  });
}

/* ----------------------------------------------------------playlist index */

export async function readPlaylists(): Promise<Entry<SpotifyPlaylist[]> | null> {
  const e = await idbGet<Entry<SpotifyPlaylist[]>>("kv", "playlists");
  if (!e || !Array.isArray(e.data) || e.v !== CACHE_V) return null;
  return e;
}

export function writePlaylists(list: SpotifyPlaylist[]): Promise<unknown> {
  return idbSet(
    "kv",
    "playlists",
    pack(list, { snapshot: null, total: list.length, firstId: null }),
  );
}

export async function clearAllCaches(): Promise<void> {
  await idbClearAll();
}
