# API reference (quick)

## Spotify OAuth

- Authorize: `GET https://accounts.spotify.com/authorize`
  - params: `client_id`, `response_type=code`, `redirect_uri`, `scope`,
    `code_challenge_method=S256`, `code_challenge`
- Token: `POST https://accounts.spotify.com/api/token`
  (`application/x-www-form-urlencoded`)
  - exchange: `client_id`, `grant_type=authorization_code`, `code`,
    `redirect_uri`, `code_verifier`
  - refresh: `client_id`, `grant_type=refresh_token`, `refresh_token`
- Redirect URI rules: HTTPS required; loopback `http://127.0.0.1:<port>` allowed;
  `localhost` banned. Must match the dashboard entry exactly (including path).

## Spotify Web API (base `https://api.spotify.com/v1`)

- `GET /me` → account info; `product` field = `premium` | `free` (Premium check).
- `GET /me/playlists?limit=20` → user's playlists.
- `GET /playlists/{id}/tracks?limit=25` → tracks. **Do NOT over-filter with
  `fields=`** — it can strip `external_ids`. Each item: `track.id`, `track.name`,
  `track.artists[].name`, `track.album.images[]`, `track.external_ids.isrc`.
- `GET /tracks/{id}` → single full track; reliably includes `external_ids.isrc`
  (useful fallback if the playlist endpoint omits it).
- `POST /playlists/{id}/tracks` body `{ "uris": ["spotify:track:ID"] }` → add.
- `DELETE /playlists/{id}/tracks` body `{ "tracks": [{ "uri": "spotify:track:ID" }] }`
  → remove.
- 429 body: `{"error":{"status":429,"reason":"QUOTA_EXCEEDED"}}` — dev-mode
  shared bucket. Back off / cache.

### Scopes
`playlist-read-private playlist-read-collaborative playlist-modify-public
playlist-modify-private user-read-playback-state user-modify-playback-state
streaming user-read-private user-read-email`

- **`user-read-private`** is what makes `GET /me` return the `product`
  (`premium`/`free`) field — required for the Premium check. `user-read-email`
  only adds `email`; it does *not* return `product`.
- The `user-read-playback-state user-modify-playback-state streaming` trio is
  only needed once the Web Playback SDK (full-track fallback) is wired; the
  iTunes-preview PoC does not request them.

## iTunes Search API (Apple) — preview source

- Base: `https://itunes.apple.com`
- By ISRC: `GET /lookup?isrc=<ISRC>&entity=song&limit=5`
- By name: `GET /search?term=<name + artist, url-encoded>&entity=song&limit=5`
- Free, no auth. Take the first result whose `previewUrl` is set; that URL is a
  ~30s MP3 playable in a plain `<audio>` element.
- **CORS risk:** if browser calls are blocked, proxy server-side. (See
  open-questions.md.)

## Web Playback SDK

- Load `https://sdk.scdn.co/spotify-player.js`, instantiate `Spotify.Player` with
  an OAuth token getter, connect, and capture the `device_id` from the `ready`
  event.
- Control playback via Web API player endpoints targeting that `device_id`:
  `PUT /me/player/play` (`{uris:[...]}` or context + `position_ms`), `pause`,
  `PUT /me/player/seek?position_ms=`, `PUT /me/player/volume?volume_percent=`.
- Premium required. Good `react-spotify-web-playback` wrappers exist if you don't
  want to hand-roll it.

## Useful references (from the planning chat)

- Spotify Web Playback SDK getting started + web app player tutorials.
- `spotify-api` community TypeScript types.
- `react-spotify-web-playback` / `react-spotify-web-playback-sdk` wrapper libs.
- Remove tracks from playlist endpoint docs.
- iframe embed + iframe API — noted but rejected (can't control cross-origin).
