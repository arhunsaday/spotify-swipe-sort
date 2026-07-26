# Open questions / unresolved

## ✅ RESOLVED: the "0/25 iTunes match rate" blocker — 2026-07-26

**Root cause found (and it was neither of the two original suspects).** The
`itunes.apple.com/lookup?isrc=<ISRC>` endpoint is **effectively dead** — it
returns `{"resultCount":0,"results":[]}` for *every* ISRC, including ISRCs
verified against MusicBrainz (e.g. Billie Eilish "bad guy" `USUM71900764`,
Ed Sheeran "Shape of You" `GBAHS2200091`, Imagine Dragons "Radioactive"
`USUM71201074`), with or without a `country=` param and regardless of whether
the country matches the ISRC prefix. No error is returned — just an empty set.
The original PoC treated ISRC lookup as the **primary** path, so it scored 0/25.

**The fix is a one-line strategy change: make `search?term=<artist name>` the
primary path.** It works and coverage is high.

**Empirical validation (run 2026-07-26, this environment):**
- **Match rate: 24/25 = 96%** across a deliberately diverse set (mainstream pop,
  jazz/Miles Davis, afrobeat/Fela Kuti, K-pop/BTS, Latin/Bad Bunny + Rosalía,
  IDM/Aphex Twin + Boards of Canada, Icelandic/Sigur Rós, experimental). The one
  miss was Arca – "Nonbinary" (very niche). All matches returned a playable
  `previewUrl`.
- **CORS is NOT a problem — no proxy needed.** A real browser `fetch()` to
  `itunes.apple.com` from an `https://` origin returned `200` with a readable
  JSON body; a control `fetch()` to a no-CORS-header origin (`google.com`) threw
  `TypeError: Failed to fetch` in the same browser, confirming the browser *does*
  enforce CORS and iTunes explicitly allows the cross-origin request.
- **Previews are playable.** An iTunes `previewUrl` loaded in a plain `<audio>`
  element reported `duration ≈ 30.0s` — the 30-second clip we need.

**Consequences baked into the plan:**
- Preview resolver order is now **search-primary**: `search?term=<artist track>`
  → (light cleanup: strip `(feat…)` / `- Remastered…` suffixes) retry → ISRC
  lookup is kept only as an *optional, best-effort* secondary that currently
  returns nothing (harmless if Apple ever restores it). **Do not** spend a
  round-trip on ISRC-first.
- **No serverless proxy** for iTunes. Browser calls are fine.
- Web Playback SDK "seek to hook" fallback remains the safety net for the ~4% of
  tracks with no iTunes match (Premium).

**Confirmed on the owner's real library (2026-07-26):** ran the PoC signed into
the actual account against a 50-track source playlist →
**48/50 = 96%** (identical to the synthetic set). Breakdown: **48 via search, 0
via ISRC, 0 "no ISRC field", 1 fetch error.** The `0 "no ISRC field"` is the
clincher — every track *had* a Spotify ISRC yet iTunes lookup matched none of
them, so the "`fields` filter stripped `external_ids`" theory is fully dead: the
ISRCs were present and correct; the iTunes ISRC endpoint just returns nothing.

**One follow-up for the real app — transient iTunes fetch errors.** 1/50 calls
threw (not a no-match — an actual fetch failure). iTunes Search is
unauthenticated and lightly throttled, so occasional failures under rapid
sequential requests are expected. The real resolver should:
- **retry once with a short backoff** on a thrown fetch before giving up, and
- fall through to "no preview" (→ Web Playback SDK) rather than surfacing an error.
This turns the ~1/50 into effectively 0 and keeps the shown match rate honest.

### Original suspects (now closed out, kept for the record)
1. ~~Spotify `fields=` filter stripped `external_ids`.~~ Real gotcha (keep the
   `fields` filter off), but not the cause — ISRC lookup returns 0 even with a
   perfect ISRC.
2. ~~Browser CORS blocking the iTunes `fetch`.~~ Disproven — iTunes allows CORS.

## Other unknowns to close

- **Actual iTunes coverage for the user's real libraries.** Test across
  mainstream vs. obscure/local playlists to gauge whether iTunes-primary is
  viable or whether SDK fallback carries more weight than expected.
- **Web Playback SDK "seek to hook" heuristic.** ~30% is a guess; may want a
  smarter pick, but keep it trivial for v1.
- **Toggle state accuracy.** To make a hotkey a true add/remove toggle we need to
  know if the track is already in the target playlist — decide whether to
  pre-fetch target playlist contents (quota cost) or track membership optimistically.
- **Quota headroom in practice.** Unknown how quickly a sorting session hits the
  shared dev-mode bucket. Measure during real use; tune caching/debounce.
