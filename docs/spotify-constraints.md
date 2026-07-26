# Spotify API constraints (verified July 2026)

These are the non-obvious limitations that dictate the whole architecture. Each
was confirmed against Spotify's developer blog / docs during the planning chat.

## 1. `preview_url` deprecated for new apps — 2024-11-27

- As of 2024-11-27, the Web API no longer serves `preview_url` (30s MP3) to:
  - apps registered on/after that date, and
  - existing apps still in development mode without a pending extension request.
- **Any app you create now will get `null`.** This is permanent for new apps.
- Policy note in the docs: audio preview clips may not be offered as a standalone
  service/product — keep previews as an in-app judging aid, not the product.

### Workarounds (in order of preference)
1. **iTunes Search API (Apple)** — free, unauthenticated, returns 30s
   `previewUrl` for most commercial tracks. Match by **ISRC** (from Spotify's
   `external_ids.isrc`), fall back to a name+artist term search. This is our
   chosen primary. Independent of Spotify quota.
2. **Web Playback SDK** — full-track playback (Premium only, login required). Use
   as fallback and for the bottom player bar. "Seek to ~30%" to approximate a hook.
3. ❌ **`/v1/search` returning a non-null preview_url** — reported as an
   undocumented quirk; unstable, likely ToS-adjacent. Do NOT build on it.
4. ❌ **iframe embed** (`open.spotify.com/embed/track/...`) — cross-origin
   sandbox means you cannot programmatically click/control it or wire keyboard
   shortcuts. Rejected.

## 2. Extended quota mode is org-only — 2025-05-15

- Extended quota mode now only accepts applications from **organizations**, with
  requirements incl. a registered business, a launched service, and **≥250k
  MAUs**. An individual cannot qualify.
- **Consequence:** the app stays in **development mode** forever.
  - Max **5 users**, each manually **allowlisted** in the dashboard
    (Settings → User Management). Non-allowlisted users get 403 on API calls.
  - **Shared quota bucket** across grouped endpoints → 429 with
    `{"error":{"status":429,"reason":"QUOTA_EXCEEDED"}}` when exceeded. Different
    from rate limits. Mitigate by caching playlist data locally.
  - The **app owner needs Spotify Premium** for a dev-mode app to work.

## 3. OAuth security migration — enforced 2025-11-27 (new apps since 2025-04-09)

- **Implicit grant flow: removed.** Use **Authorization Code Flow with PKCE**.
- **HTTP redirect URIs: rejected.** Must be **HTTPS** …
- **…except loopback addresses**, where HTTP is still permitted.
- **The literal `localhost` alias is banned.** Use **`http://127.0.0.1:<port>`**
  for local dev instead. Loopback may use dynamically assigned ports.
- Dashboard gotcha: if saving the redirect URI errors with a vague "something
  went wrong," delete any leftover `localhost` entry so only the `127.0.0.1`
  entry remains, then save.
- Deployed (non-loopback) builds require a real **HTTPS** URL.

## Practical implications baked into the design

- Preview audio = iTunes, not Spotify. Budget for a match-rate < 100% and a
  Web Playback SDK fallback.
- Assume Premium for anyone using the app; document it in the README.
- Cache playlists/track lists (Zustand persist) to respect the shared quota.
- Local dev URL is always `http://127.0.0.1:<port>/...`, never `localhost`.
