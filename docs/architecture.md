# Architecture

## Auth (Authorization Code + PKCE, no backend)

Client-side PKCE — no client secret, no server. Flow:

1. Generate a random `code_verifier`; store it (sessionStorage/localStorage).
2. `code_challenge = base64url(sha256(verifier))`.
3. Redirect to `https://accounts.spotify.com/authorize` with
   `response_type=code`, `client_id`, `redirect_uri`, `scope`,
   `code_challenge_method=S256`, `code_challenge`.
4. On return, exchange `code` at `https://accounts.spotify.com/api/token`
   (`grant_type=authorization_code`, include `code_verifier`).
5. Store `{access_token, refresh_token, expires_at}`. Refresh ~30s before expiry
   with `grant_type=refresh_token` (carry the old refresh_token forward if the
   response omits a new one).
6. "Reset auth" = clear stored tokens + verifier and return to the redirect URI.

Scopes needed:
- `playlist-read-private playlist-read-collaborative` — read playlists.
- `playlist-modify-public playlist-modify-private` — add/remove tracks (write).
- `user-read-playback-state user-modify-playback-state streaming` — Web Playback SDK.
- `user-read-email` (optional, to show account + `product` for the Premium check).

The PoC already implements steps 1–6 for the read scopes — reuse it.

## Preview resolver (`src/lib/previewResolver`)

Single function that, given a Spotify track, returns a playable preview URL and
how it was found. Order (**SEARCH-primary** — validated 2026-07-26, see
open-questions.md):

1. iTunes `search?term=<primaryArtist + name>&entity=song&limit=1` → first result
   with `previewUrl`. **This is the primary path (~96% hit rate).**
2. on miss → retry search with a **cleaned title** (strip `(feat…)`, `[..]`,
   `- Remastered/Live/…` suffixes) — absorbs Spotify's metadata cruft.
3. else → signal "no preview"; the UI can offer Web Playback SDK full-track play
   (seek ~30%) as fallback.
4. `external_ids.isrc` → `lookup?isrc=…` is kept ONLY as an optional best-effort
   probe. The endpoint is currently **dead** (returns `resultCount:0` for every
   ISRC), so it never carries the primary path — do not put it first.

Return shape: `{ url: string | null, via: "search" | "isrc" | "sdk" | null }`.

✅ **CORS is not an issue — no proxy needed.** A browser `fetch` to
`itunes.apple.com` returns 200 with a readable body (confirmed against a control
fetch that correctly throws), so iTunes is called directly from the client.

Caching: memoize resolved previews by track id in the session store so re-visiting
a track during navigation is instant and doesn't re-hit iTunes.

## Playback (bottom player)

- Load the **Web Playback SDK** script; create a player; obtain a `device_id`.
- Control via `PUT /v1/me/player/play` (with `device_id`), `pause`, `seek`,
  `volume`. Premium required.
- The iTunes preview uses a plain `<audio>` element and is independent of the SDK;
  keep the two playback paths from fighting (pause one when starting the other).

## State (Zustand + persist)

- `authStore`: tokens, `product` (free/premium), login/logout, refresh.
- `playlistStore` (persisted): source playlist id, list of target playlists with
  their bound hotkeys, cached playlist metadata.
- `sessionStore`: current track index, resolved-preview cache, transient UI
  (which preview is playing, last action for undo).

Persist the chosen source/target playlists and the hotkey bindings so a reload
picks up where you left off (matches the original "persist zustand" note).

## Keyboard model (the core of the UX)

- `ArrowLeft` / `ArrowRight` (or `h`/`l`): previous / next track in source.
- Number keys `1..9` and/or letters: each bound to a target playlist; press to
  **toggle** the current track's membership in that playlist.
- `Space`: play/pause the current preview.
- After a successful add/remove, **auto-advance** to the next track (should-have;
  make it a toggle so users can disable it).
- Show a small toast per action with an **undo** (undo = the inverse add/remove
  call). Debounce rapid keypresses so you don't spam the API (and the quota).
- Central keydown handler; ignore when focus is in an input.

## Add / remove track calls

- Add: `POST /v1/playlists/{playlist_id}/tracks` with `{ uris: ["spotify:track:ID"] }`.
- Remove: `DELETE /v1/playlists/{playlist_id}/tracks` with
  `{ tracks: [{ uri: "spotify:track:ID" }] }`.
- Track "already in playlist" state where possible to make the hotkey a true
  toggle and to power duplicate detection (could-have).

## Quota discipline

Every design choice should minimize Spotify calls: cache playlist contents,
batch where the API allows, debounce hotkeys, and prefer iTunes (no Spotify
quota) for previews. Handle 429 `QUOTA_EXCEEDED` gracefully with a visible
"slow down / try later" state rather than silent failure.
