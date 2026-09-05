/* The Web Playback SDK: this tab registers itself as a Spotify device, so we
 * can play whole tracks instead of 30s iTunes previews.
 *
 * Why the SDK rather than remote-controlling an already-open Spotify client:
 * the SDK *pushes* state (`player_state_changed`) and `seek`/`togglePlay` are
 * local calls, so a precise scrubber costs nothing. Remote control would mean
 * polling `GET /me/player` forever against the shared dev-mode quota bucket.
 *
 * Starting a track is still one Web API call (`playTrackOnDevice`) — one per
 * track change, which is the same order as the preview lookups it replaces.
 *
 * Requires Premium and a browser with EME/Widevine. Both failures surface as
 * SDK error events, which is why the caller gets a status + message. */

import { getDevices } from "@/api/spotify";
import { sleep } from "@/lib/utils";
import { useAuthStore } from "@/store/useAuthStore";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";
const DEVICE_NAME = "Spotify Swiper";
/** Position events are sparse, so we interpolate between them at this rate. */
const TICK_MS = 250;
/** `ready` normally lands in well under a second; past this something's wrong. */
const READY_TIMEOUT_MS = 12_000;
/** `ready` says the browser player booted; Spotify Connect registers it with
 *  the account a moment later, and anything addressed to the device before then
 *  comes back 404 "Device not found". These are the waits between registration
 *  checks — growing, so a slow registration doesn't cost a burst of requests. */
const REGISTER_BACKOFF_MS = [400, 600, 900, 1300, 1900, 2800];

/** After we move the playhead, the SDK keeps echoing the pre-seek position for
 *  a moment. Trusting those echoes yanks the scrubber back, so we hold our own
 *  position this long. `paused` is never held — it's authoritative at once, and
 *  that's what keeps the play button from bouncing. */
const SEEK_GRACE_MS = 700;

/** The SDK's failure modes are all invisible from the outside (a device that
 *  never registers looks identical to one that never booted), so the lifecycle
 *  is traced. Filter the console on "sdk" when something misbehaves. */
const trace = (...args: unknown[]) => console.debug("[sdk]", ...args);

export type SdkStatus = "off" | "connecting" | "ready" | "error";

export interface SdkState {
  playing: boolean;
  /** milliseconds */
  position: number;
  duration: number;
}

let player: Spotify.Player | null = null;
let deviceId: string | null = null;
let scriptPromise: Promise<void> | null = null;
let readyPromise: Promise<string> | null = null;
let ticker: number | null = null;

/** Last known state, plus when — the ticker extrapolates position from it. */
let anchor = { playing: false, position: 0, duration: 0, at: 0 };
/** When we last moved the playhead ourselves. See SEEK_GRACE_MS. */
let seekAt = 0;

const livePosition = () =>
  anchor.playing
    ? Math.min(anchor.position + (Date.now() - anchor.at), anchor.duration)
    : anchor.position;

let emitState: (s: SdkState) => void = () => {};
let emitStatus: (s: SdkStatus, error?: string) => void = () => {};

/** The player store registers here (same pattern as `registerTokenProvider`). */
export function registerSdkListeners(
  onState: (s: SdkState) => void,
  onStatus: (s: SdkStatus, error?: string) => void,
) {
  emitState = onState;
  emitStatus = onStatus;
}

export const getDeviceId = () => deviceId;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.Spotify) return resolve();
    // The SDK calls this global once it has parsed; it must exist beforehand.
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const el = document.createElement("script");
    el.src = SDK_SRC;
    el.async = true;
    el.onerror = () => reject(new Error("Spotify SDK script failed to load"));
    document.head.appendChild(el);
  });
  return scriptPromise;
}

function startTicker() {
  if (ticker !== null) return;
  ticker = window.setInterval(() => {
    emitState({
      playing: anchor.playing,
      position: livePosition(),
      duration: anchor.duration,
    });
  }, TICK_MS);
}

function stopTicker() {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
}

/** Connect (idempotent) and resolve with the device id once Spotify accepts us.
 *  The connection outlives a switch back to previews — registering costs
 *  seconds and a handful of requests, so we keep the device and just silence
 *  it. Only a hard failure tears the player down. */
export function connectSdk(initialVolume: number): Promise<string> {
  if (readyPromise) return readyPromise;
  // a player whose device went away can't be revived — drop it before rebuilding
  if (player) {
    player.disconnect();
    player = null;
  }

  readyPromise = (async () => {
    emitStatus("connecting");
    await loadScript();

    return await new Promise<string>((resolve, reject) => {
      const p = new window.Spotify.Player({
        name: DEVICE_NAME,
        getOAuthToken: (cb) => {
          void useAuthStore
            .getState()
            .getValidAccessToken()
            .then((t) => {
              if (t) cb(t);
            });
        },
        volume: initialVolume,
      });
      player = p;

      const timer = window.setTimeout(
        () => fail("Spotify player timed out while connecting"),
        READY_TIMEOUT_MS,
      );

      function fail(message: string) {
        trace("failed:", message);
        window.clearTimeout(timer);
        emitStatus("error", message);
        reject(new Error(message));
      }

      p.addListener("ready", ({ device_id }) => {
        window.clearTimeout(timer);
        deviceId = device_id;
        trace("player booted, device", device_id, "— awaiting registration");
        startTicker();
        // Don't report ready until the device is addressable — "connected" has
        // to mean "usable", or the first play lands in the 404 window.
        void awaitRegistration(device_id).then((registered) => {
          if (!registered) {
            return fail("Spotify never registered the in-app player");
          }
          trace("registered and ready");
          emitStatus("ready");
          resolve(device_id);
        });
      });

      p.addListener("not_ready", () => {
        trace("device went offline");
        deviceId = null;
        // invalidate the cached connection, or the next play would be addressed
        // to a device id Spotify no longer knows
        readyPromise = null;
        emitStatus("error", "Spotify player went offline");
      });

      p.addListener("player_state_changed", (state) => {
        if (!state) return;
        const holdPosition = Date.now() - seekAt < SEEK_GRACE_MS;
        anchor = {
          playing: !state.paused,
          duration: state.duration,
          position: holdPosition ? livePosition() : state.position,
          at: Date.now(),
        };
      });

      // Premium and browser-DRM failures both land here, before `ready`.
      p.addListener("account_error", () =>
        fail("Spotify Premium is required for in-app playback"),
      );
      p.addListener("initialization_error", ({ message }) =>
        fail(`This browser can't run the Spotify player: ${message}`),
      );
      p.addListener("authentication_error", () =>
        fail("Reconnect Spotify to allow in-app playback"),
      );
      p.addListener("playback_error", ({ message }) =>
        emitStatus("error", message),
      );

      void p.connect();
    });
  })();

  // let a failed attempt be retried
  readyPromise.catch(() => {
    readyPromise = null;
  });
  return readyPromise;
}

/** Poll until Spotify itself lists the device, so callers can address it. */
async function awaitRegistration(id: string): Promise<boolean> {
  for (const wait of REGISTER_BACKOFF_MS) {
    await sleep(wait);
    try {
      const devices = await getDevices();
      trace("registration probe:", devices.map((d) => d.name));
      if (devices.some((d) => d.id === id)) return true;
    } catch {
      // a failed probe says nothing about the device — keep waiting
    }
  }
  return false;
}

/** Tear the player down for good. Switching back to previews does NOT do this
 *  — see `connectSdk`; this is for a player that failed and must be rebuilt. */
export function disconnectSdk() {
  stopTicker();
  const leaving = player;
  player = null;
  deviceId = null;
  readyPromise = null;
  activated = false;
  anchor = { playing: false, position: 0, duration: 0, at: 0 };
  // pause first: `disconnect()` on its own can leave the last buffer sounding,
  // which would overlap the preview we're switching back to
  if (leaving) {
    void leaving
      .pause()
      .catch(() => {})
      .finally(() => leaving.disconnect());
  }
  emitStatus("off");
}

let activated = false;

/** Satisfies the browser autoplay policy. Must ride a real user gesture, so
 *  it's called both from the settings switch and from the first play/pause —
 *  after a reload with the mode already on, that click is what unmutes us. */
export function activateSdkElement() {
  if (activated || !player) return;
  activated = true;
  void player.activateElement();
}

/* Local commands — no network, no quota.
 *
 * Only seeking updates the anchor optimistically, so the scrubber answers on
 * the same frame. Play/pause deliberately does NOT: these are local operations
 * the SDK confirms within a frame or two, and predicting them meant our guess
 * and the SDK's echo took turns winning — which is what made the button flicker.
 *
 * They also address the transport explicitly rather than toggling, so a command
 * can't invert into its opposite when our idea of the state has drifted. */

export function sdkSeek(ms: number) {
  seekAt = Date.now();
  anchor = { ...anchor, position: ms, at: Date.now() };
  void player?.seek(ms);
}

export function sdkTogglePlay() {
  void player?.togglePlay();
}

export function sdkResume() {
  void player?.resume();
}

export function sdkPause() {
  void player?.pause();
}

export function sdkSetVolume(v: number) {
  void player?.setVolume(v);
}

/** Called when a new track starts, so the scrubber doesn't show the old one. */
export function sdkAnchorTo(positionMs: number, durationMs: number) {
  seekAt = Date.now(); // a new track is a playhead move like any other
  anchor = {
    playing: true,
    position: positionMs,
    duration: durationMs,
    at: Date.now(),
  };
}
