# Spotify Playlist Sorter

A fast, keyboard-driven personal tool for triaging Spotify tracks into playlists.
Preview the current track, arrow left/right through a source playlist, and press
a hotkey to add/remove it to/from a target playlist.

**Start here:** read [`CLAUDE.md`](./CLAUDE.md). It's the context handoff and the
source of truth. The `docs/` folder has the detail.

## Status

Prototype stage — **concept validated.** The single-file proof of concept lives in
[`prototype/spotify-preview-poc.html`](./prototype/spotify-preview-poc.html): it
does PKCE OAuth, lists playlists, resolves iTunes previews, and has a focus view
with keyboard nav + add-to-target (write).

✅ **The "0/25" blocker is resolved** (see
[`open-questions.md`](./open-questions.md)). Root cause: iTunes' `lookup?isrc=`
endpoint is dead — the old approach used ISRC as the *primary* path. Fix: make
**name+artist search primary**, which measures **~96%** coverage with playable
30s previews. **CORS is not a problem — no proxy needed.** Remaining step before
scaffolding the real app: run the PoC signed into the actual account and confirm
the match rate holds on your own library.

> The docs referenced below as `docs/…` currently live at the **repo root**.

## Running the prototype

1. Create an app at https://developer.spotify.com/dashboard and copy the Client ID.
2. Add your own account under **Settings → User Management** (dev-mode allowlist).
3. Add redirect URI **exactly**: `http://127.0.0.1:8888/spotify-preview-poc.html`
   (loopback IP, NOT `localhost` — see constraints).
4. Serve the file: `python3 -m http.server 8888` from the `prototype/` folder.
5. Open `http://127.0.0.1:8888/spotify-preview-poc.html`, paste the Client ID,
   log in, pick a playlist. Read the status breakdown; open the console (F12) if
   the match rate is 0.

## Hard constraints (see `docs/spotify-constraints.md`)

- Spotify `preview_url` is dead for new apps → previews come from the **iTunes
  Search API** (by ISRC, then name search).
- App is stuck in **development mode** (5 allowlisted users, shared quota) —
  individuals can't get extended quota. Fine for a personal tool.
- App owner needs **Spotify Premium**.
- OAuth: **PKCE**, **HTTPS** redirect URIs, `localhost` banned (use `127.0.0.1`
  loopback for local dev).

## Planned stack

Vite + React + TypeScript · Zustand (persisted) · Spotify Web Playback SDK ·
`<audio>` for iTunes previews. See `docs/architecture.md`.
