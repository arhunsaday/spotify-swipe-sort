import type {
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyUser,
} from "@/types";
import { spotifyFetch } from "./client";

interface Paged<T> {
  items: T[];
  next: string | null;
}

export const LIKED_SOURCE_ID = "__liked__";

export async function getMe(): Promise<SpotifyUser> {
  return spotifyFetch<SpotifyUser>("/me");
}

/** All of the user's playlists (follows pagination). */
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

interface PlaylistTrackItem {
  track: SpotifyTrack | null;
}
interface SavedTrackItem {
  track: SpotifyTrack | null;
}

/** Source tracks — no `fields=` filter (that strips external_ids). */
export async function getPlaylistTracks(
  playlistId: string,
  max = 500,
): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  let url: string | null = `/playlists/${playlistId}/tracks?limit=50`;
  while (url && out.length < max) {
    const page: Paged<PlaylistTrackItem> = await spotifyFetch<
      Paged<PlaylistTrackItem>
    >(url);
    for (const it of page.items || []) {
      if (it.track && it.track.id) out.push(it.track);
    }
    url = page.next;
  }
  return out;
}

export async function getLikedTracks(max = 500): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  let url: string | null = "/me/tracks?limit=50";
  while (url && out.length < max) {
    const page: Paged<SavedTrackItem> = await spotifyFetch<
      Paged<SavedTrackItem>
    >(url);
    for (const it of page.items || []) {
      if (it.track && it.track.id) out.push(it.track);
    }
    url = page.next;
  }
  return out;
}

/** Set of track IDs already in a playlist — powers toggles + dupe detection. */
export async function getPlaylistTrackIds(
  playlistId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let url:
    | string
    | null = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id))`;
  while (url) {
    const page: Paged<PlaylistTrackItem> = await spotifyFetch<
      Paged<PlaylistTrackItem>
    >(url);
    for (const it of page.items || []) if (it.track?.id) ids.add(it.track.id);
    url = page.next;
  }
  return ids;
}

export async function addTrackToPlaylist(playlistId: string, uri: string) {
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris: [uri] }),
  });
}

export async function removeTrackFromPlaylist(playlistId: string, uri: string) {
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: "DELETE",
    body: JSON.stringify({ tracks: [{ uri }] }),
  });
}

// Batched variants — Spotify accepts up to 100 URIs per add/remove request.
export async function addTracksToPlaylist(playlistId: string, uris: string[]) {
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });
}

export async function removeTracksFromPlaylist(
  playlistId: string,
  uris: string[],
) {
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: "DELETE",
    body: JSON.stringify({ tracks: uris.map((uri) => ({ uri })) }),
  });
}

export async function saveTrackToLiked(trackId: string) {
  await spotifyFetch(`/me/tracks?ids=${trackId}`, { method: "PUT" });
}

export async function removeTrackFromLiked(trackId: string) {
  await spotifyFetch(`/me/tracks?ids=${trackId}`, { method: "DELETE" });
}
