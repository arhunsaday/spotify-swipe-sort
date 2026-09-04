/** Minimal shapes we actually use from the Spotify Web API. */
export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface SpotifyArtist {
  id: string;
  name: string;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: { name: string; images: SpotifyImage[] };
  external_ids?: { isrc?: string };
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  images: SpotifyImage[];
  tracks: { total: number };
  owner: { display_name?: string; id: string };
  /** Changes on *any* edit to the playlist — our cache validator. */
  snapshot_id?: string;
  /** Synthetic marker for the pseudo-playlist "Liked Songs". */
  isLiked?: boolean;
}

/** Cheap fingerprint of a remote list, used to decide whether a cached copy is
 *  still good. One request to obtain, and it moves whenever the list moves:
 *  playlists carry `snapshot_id`; Liked Songs has none, so it pairs `total`
 *  with the id of the most-recently-saved track. */
export interface ListStamp {
  snapshot: string | null;
  total: number;
  firstId: string | null;
}

export interface SpotifyUser {
  id: string;
  display_name?: string;
  email?: string;
  product?: "premium" | "free" | "open";
  images?: SpotifyImage[];
}

/** A destination pile bound to a hotkey. */
export interface Target {
  id: string;
  name: string;
  imageUrl?: string;
  key: string; // "1".."9"
}

export type PreviewVia = "search" | "isrc" | null;

export interface PreviewResult {
  url: string | null;
  via: PreviewVia;
  error?: string;
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
