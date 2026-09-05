import { toast } from "sonner";
import { ApiError, QuotaError } from "@/api/client";
import { playTrackOnDevice, type SpotifyDevice } from "@/api/spotify";
import {
  activateSdkElement,
  connectSdk,
  disconnectSdk,
  sdkAnchorTo,
  sdkPause,
} from "@/lib/spotify-sdk";
import { useAuthStore } from "@/store/useAuthStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { sleep } from "@/lib/utils";
import type { SpotifyTrack } from "@/types";

/** Drop in this far through the track — the substitute for the dead 30s
 *  preview_url, per the preview strategy in CLAUDE.md: far enough in to land
 *  on the hook rather than an intro. */
const HOOK_FRACTION = 0.3;

/** `ready` fires before Spotify's backend has registered the device, so a play
 *  call sent in that window comes back 404 "Device not found". Retrying beats
 *  making the user pick the device by hand. Only the first track after a
 *  connect ever pays for this. */
const DEVICE_RETRIES = 4;
const DEVICE_RETRY_MS = 350;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function playAwaitingDevice(
  deviceId: string,
  uri: string,
  positionMs: number,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await playTrackOnDevice(deviceId, uri, positionMs);
    } catch (e) {
      const unregistered = e instanceof ApiError && e.status === 404;
      if (!unregistered || attempt >= DEVICE_RETRIES) throw e;
      await sleep(DEVICE_RETRY_MS);
    }
  }
}

/* ------------------------------------------------- full-track mode (SDK) */

/** Connect the in-app player, or give up on full-track mode entirely.
 *  A player that can't start (no Premium, no browser DRM, stale scopes) is not
 *  a transient failure, so we fall back to previews instead of silence. */
let sdkAttempt: Promise<string | null> | null = null;

function ensureSdk(): Promise<string | null> {
  if (!sdkAttempt) {
    sdkAttempt = attemptSdk().finally(() => {
      sdkAttempt = null;
    });
  }
  return sdkAttempt;
}

async function attemptSdk(): Promise<string | null> {
  try {
    const deviceId = await connectSdk(usePlayerStore.getState().volume);
    activateSdkElement(); // browsers want a gesture before audio; this is close enough
    return deviceId;
  } catch (e) {
    useLibraryStore.getState().setSetting("fullTracks", false);
    disconnectSdk();
    const description = msg(e);
    toast.error("Full-track playback unavailable — back to previews", {
      description,
      action: /reconnect/i.test(description)
        ? {
            label: "Reconnect",
            onClick: () => void useAuthStore.getState().login(),
          }
        : undefined,
    });
    return null;
  }
}

/** Turn full-track mode on/off. Called from a click, which is what lets the
 *  SDK produce sound at all. */
export function setFullTracks(on: boolean) {
  // silence the outgoing engine before the swap, never two sources at once.
  // Leaving full mode only pauses the player: keeping the device registered is
  // what makes toggling back instant instead of an 8-second reconnect.
  if (on) usePlayerStore.getState().stopPreview();
  else sdkPause();
  // neither engine reports "stopped" on the way out — the preview's pause event
  // is suppressed mid-switch, and the SDK ticker is already gone — so clear the
  // transport by hand and let the incoming engine report its own state
  usePlayerStore.setState({ playing: false, currentTime: 0 });
  useLibraryStore.getState().setSetting("fullTracks", on);
  if (on) void ensureSdk();
}

export function toggleFullTracks() {
  setFullTracks(!useLibraryStore.getState().settings.fullTracks);
}

/** Start the current track in-app, already at the hook. */
export async function playFullTrack(track: SpotifyTrack): Promise<boolean> {
  const deviceId = await ensureSdk();
  if (!deviceId) return false;
  const position = Math.round(track.duration_ms * HOOK_FRACTION);
  try {
    await playAwaitingDevice(deviceId, track.uri, position);
    sdkAnchorTo(position, track.duration_ms);
    return true;
  } catch (e) {
    // the player is fine, this one track isn't — stay in full-track mode
    const stillUnregistered = e instanceof ApiError && e.status === 404;
    toast.error(
      e instanceof QuotaError
        ? "Spotify quota exceeded — try again shortly"
        : stillUnregistered
          ? "Spotify never registered the in-app player"
          : "Couldn't start that track",
      {
        description: stillUnregistered
          ? "Pick a device from the speaker menu instead."
          : e instanceof QuotaError
            ? undefined
            : msg(e),
      },
    );
    return false;
  }
}

/* ---------------------------------------------------- explicit device pick */

/** Send the current track to a device the user picked by name. Unlike the old
 *  "guess the active device" path, a failure here is unambiguous. */
export async function playOnDevice(
  track: SpotifyTrack,
  device: SpotifyDevice,
): Promise<void> {
  if (!device.id) return;
  try {
    await playTrackOnDevice(device.id, track.uri);
    // toast.success(`Playing on ${device.name}`, { description: track.name }); // useless
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) {
      // Old tokens predate the playback scopes; a refresh keeps the old set,
      // so the only fix is a fresh authorization.
      if (/scope/i.test(e.message)) {
        toast.error("Reconnect Spotify to allow playback control", {
          action: {
            label: "Reconnect",
            onClick: () => void useAuthStore.getState().login(),
          },
        });
      } else {
        toast.error("Spotify Premium is required to control playback");
      }
      return;
    }
    toast.error(
      e instanceof QuotaError
        ? "Spotify quota exceeded — try again shortly"
        : `Couldn't play on ${device.name}`,
      { description: e instanceof QuotaError ? undefined : msg(e) },
    );
  }
}
