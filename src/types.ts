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
  /** Synthetic marker for the pseudo-playlist "Liked Songs". */
  isLiked?: boolean;
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
