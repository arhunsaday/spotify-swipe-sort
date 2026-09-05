import { create } from "zustand";
import type { PreviewVia } from "@/types";
import { useLibraryStore } from "./useLibraryStore";
import {
  activateSdkElement,
  registerSdkListeners,
  sdkPause,
  sdkResume,
  sdkSeek,
  sdkSetVolume,
  sdkTogglePlay,
  type SdkStatus,
} from "@/lib/spotify-sdk";

/* Two playback engines behind one interface: the shared <audio> element for
 * 30s iTunes previews, and the Web Playback SDK for whole tracks. The UI
 * (PlayerBar, FocusView) calls toggle/seekFraction/setVolume without caring
 * which is live — `fullTracks` is the single source of truth for that. */

const audio =
  typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) {
  audio.preload = "auto";
  audio.volume = 0.8;
}

const onSpotify = () => useLibraryStore.getState().settings.fullTracks;

interface PlayerState {
  url: string | null;
  playing: boolean;
  /** seconds, whichever engine is live */
  currentTime: number;
  duration: number;
  volume: number;
  previewVia: PreviewVia | "loading" | "none" | "spotify";
  sdkStatus: SdkStatus;
  sdkError: string | null;
  setPreviewVia: (v: PlayerState["previewVia"]) => void;
  /** preview engine only — the SDK is fed by `playFullTrack`. */
  load: (url: string | null, autoplay: boolean) => void;
  /** stop the preview engine without touching the SDK (used when switching). */
  stopPreview: () => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seekFraction: (f: number) => void;
  setVolume: (v: number) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  url: null,
  playing: false,
  currentTime: 0,
  duration: 30,
  volume: 0.8,
  previewVia: "loading",
  sdkStatus: "off",
  sdkError: null,

  setPreviewVia: (v) => set({ previewVia: v }),

  load: (url, autoplay) => {
    if (!audio) return;
    set({ url, currentTime: 0 });
    if (!url) {
      audio.pause();
      audio.removeAttribute("src");
      set({ playing: false });
      return;
    }
    audio.src = url;
    audio.currentTime = 0;
    if (autoplay) {
      audio.play().catch(() => set({ playing: false }));
    }
  },

  stopPreview: () => {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    set({ url: null });
  },

  toggle: () => {
    if (onSpotify()) {
      activateSdkElement(); // this click is a user gesture — spend it
      return sdkTogglePlay();
    }
    return get().playing ? get().pause() : get().play();
  },

  play: () => {
    if (onSpotify()) {
      sdkResume();
      return;
    }
    if (!audio || !get().url) return;
    audio.play().catch(() => set({ playing: false }));
  },

  pause: () => {
    if (onSpotify()) return sdkPause();
    audio?.pause();
  },

  seekFraction: (f) => {
    const clamped = Math.max(0, Math.min(1, f));
    if (onSpotify()) return sdkSeek(clamped * get().duration * 1000);
    if (!audio) return;
    audio.currentTime = clamped * (audio.duration || get().duration);
  },

  setVolume: (v) => {
    if (audio) audio.volume = v;
    sdkSetVolume(v);
    set({ volume: v });
  },
}));

/* The SDK pushes position/duration; the store just mirrors it in seconds. */
registerSdkListeners(
  ({ playing, position, duration }) => {
    if (!onSpotify()) return;
    usePlayerStore.setState({
      playing,
      currentTime: position / 1000,
      duration: duration / 1000 || 1,
    });
  },
  (sdkStatus, sdkError) =>
    usePlayerStore.setState({ sdkStatus, sdkError: sdkError ?? null }),
);

/* Preview-engine events. Guarded so a stray pause/ended from the idle <audio>
 * can't clobber the SDK's state while full-track mode is live. */
if (audio) {
  const fromPreview = (fn: () => void) => () => {
    if (!onSpotify()) fn();
  };
  audio.addEventListener(
    "timeupdate",
    fromPreview(() =>
      usePlayerStore.setState({ currentTime: audio.currentTime }),
    ),
  );
  audio.addEventListener(
    "loadedmetadata",
    fromPreview(() =>
      usePlayerStore.setState({ duration: audio.duration || 30 }),
    ),
  );
  audio.addEventListener(
    "play",
    fromPreview(() => usePlayerStore.setState({ playing: true })),
  );
  audio.addEventListener(
    "pause",
    fromPreview(() => usePlayerStore.setState({ playing: false })),
  );
  audio.addEventListener(
    "ended",
    fromPreview(() => usePlayerStore.setState({ playing: false })),
  );
}
