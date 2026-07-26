# CLAUDE.md — Spotify Playlist Sorter

> Context handoff from an earlier planning/prototyping chat. This file is the
> single source of truth for what the app is, the hard constraints discovered,
> the decisions made, and where we left off. Read `docs/` for detail.

## What we're building

A **personal web app to quickly triage / sort tracks into Spotify playlists**.

Core UX (the whole point is *speed*):
- One main "focus" view showing the current track (cover, title, artist).
- A short audio **preview** of the current track plays so you can judge it fast.
- **Left / right keyboard shortcuts** move between tracks in a source playlist.
- A visible list of **target playlists**, each bound to a **numeric or alphabetic
  hotkey**. Pressing the key **adds/removes** the current track to/from that
  playlist instantly, then (should-have) auto-advances to the next track.
- A **bottom player bar** for finer manual control (play/pause, seek, volume).

This is a **personal tool**, not a launchable public product (see constraints).

## Hard constraints discovered (these shaped every decision — do not relitigate)

1. **`preview_url` is deprecated for new apps.** Since 2024-11-27, Spotify's
   Web API returns `null` for `preview_url` on any newly-registered app. We
   cannot rely on Spotify for preview audio. **This is why previews come from
   the iTunes Search API instead** (match by ISRC → fall back to name+artist
   search). See `docs/spotify-constraints.md`.

2. **Cannot leave development mode as an individual.** Since 2025-05-15, extended
   quota mode is org-only and requires ~250k MAU. So the app lives permanently in
   **development mode**: max **5 allowlisted users**, and a **shared quota bucket**
   (429 `QUOTA_EXCEEDED` if hammered). This is fine for a personal tool. Cache
   aggressively to stay under quota.

3. **App owner must have Spotify Premium** for a dev-mode app to function at all,
   and Premium is required for the Web Playback SDK anyway.

4. **OAuth: HTTPS redirect URIs only, `localhost` is banned.** Since the
   2025-11-27 OAuth migration: implicit grant is gone (use **Authorization Code
   + PKCE**), HTTP redirect URIs are rejected, and the literal `localhost` alias
   is prohibited. **Loopback IP `http://127.0.0.1` over plain HTTP is still
   allowed** — that's the local-dev workaround. Deployed builds need real HTTPS
   (Netlify/Vercel/GH Pages all give free HTTPS).

## Key architectural decision: preview strategy

**Primary preview source = iTunes Search API** (free, unauthenticated, no Spotify
quota cost). Flow per track (**SEARCH-primary** — see the resolved blocker below):
1. `GET https://itunes.apple.com/search?term=<artist name>&entity=song&limit=1`
   → take the first result with a `previewUrl`.
2. **Retry with a cleaned title** if no match: strip `(feat…)` / `[..]` /
   `- Remastered…`-style suffixes, then search again.
3. `external_ids.isrc` + `lookup?isrc=…` is kept only as an *optional, best-effort*
   probe — it currently returns **nothing** for every ISRC (endpoint is dead), so
   never make it the primary path or spend a round-trip on it first.

**Fallback = Spotify Web Playback SDK** for full-track playback (Premium), with a
"seek to ~30% to hear the hook" trick as a substitute for the dead preview when
iTunes has no match (~4% of tracks). Treat SDK as should-have, iTunes preview as
must-have.

✅ **RESOLVED (2026-07-26) — the "0/25" blocker.** Root cause was neither original
suspect: **iTunes' `lookup?isrc=` endpoint is dead** (returns `resultCount:0` for
every ISRC, even ones verified via MusicBrainz), and the old PoC used ISRC as the
*primary* path → 0/25. Fix = make **name+artist search primary**. Measured
**24/25 (96%)** match rate across a deliberately diverse set, all with playable
30s previews. **CORS is NOT a problem — no proxy needed** (browser `fetch` to
iTunes returns 200; a control fetch to a no-CORS origin throws, proving the
browser enforces CORS and iTunes allows it). Full write-up + evidence in
`open-questions.md`. The runnable PoC is `prototype/spotify-preview-poc.html`.

## MoSCoW (current)

**Must:** PKCE OAuth (+ refresh, reset auth) · list playlists · load a source
playlist · main view of current track · left/right keyboard nav · add/remove
current track to target playlists via hotkeys · **iTunes preview of current
track** · Zustand-persist (chosen playlists, position).

**Should:** bottom player bar (keyboard-controllable) · target-playlist list with
visible hotkey mapping · action toasts + undo · auto-advance after sort · Web
Playback SDK full-track fallback.

**Could:** ambient color from album art · data-grid list view (AG Grid /
TanStack Table) · duplicate / "already in playlist" detection · batch actions ·
sort history.

**Won't (for now):** non-Premium user support · 30s `preview_url` (deprecated) ·
programmatic control of the Spotify iframe embed (cross-origin sandbox blocks it) ·
public/SaaS launch (dev-mode cap).

## Suggested stack

- **Vite + React + TypeScript** (SPA, no server needed for OAuth thanks to PKCE).
- **Zustand** (+ `persist` middleware) for state.
- **Spotify Web Playback SDK** loaded via `<script>` for full playback.
- Plain `<audio>` for iTunes previews.
- Optional later: a minimal serverless function ONLY if iTunes CORS forces a proxy.
- Types: `spotify-api` community types (`@types/spotify-api` / spotify-api types repo).

## Repo layout (proposed)

```
/               Vite app root
  index.html
  src/
    auth/       PKCE flow, token storage + refresh
    api/        spotify client (fetch wrapper w/ 429 handling), itunes client
    store/      zustand stores (auth, playlists, session)
    features/
      focus/    main current-track view + keyboard nav
      player/   bottom player bar (Web Playback SDK)
      targets/  target-playlist list + hotkey binding
    lib/        preview resolver (search -> cleaned-search -> sdk fallback)
  (docs live at repo root, not docs/ — see Reference below)
  prototype/    <- the single-file PoC (reference implementation)
```

> Note: the docs referenced as `docs/…` throughout this file currently live at
> the **repo root** (`open-questions.md`, `architecture.md`, etc.), not in a
> `docs/` folder.

## First moves in Claude Code

1. ✅ **DONE — iTunes question resolved.** Search-primary, no proxy, ~96% match.
   The PoC (`prototype/spotify-preview-poc.html`) now exists and is validated for
   preview resolution (OAuth/read/write still need a real login to exercise).
2. **Confirm on the owner's real library:** serve the PoC (see README), log in,
   run the "Preview match diagnostic," and check the match rate holds. Only then
   scaffold the real app.
3. **Port the PoC's PKCE + playlist logic** into `src/auth` and `src/api` when
   scaffolding Vite/React/TS + Zustand; build the focus view + keyboard nav
   against a hardcoded source playlist before wiring the target-playlist hotkeys.

## Reference

- `spotify-constraints.md` — every API limitation, with dates.
- `architecture.md` — preview resolver, auth, state, keyboard model.
- `open-questions.md` — the (now resolved) 0/25 debug + other unknowns to close.
- `api-reference.md` — exact endpoints, scopes, iTunes params, gotchas.
- `prototype/spotify-preview-poc.html` — runnable reference for OAuth + preview.
