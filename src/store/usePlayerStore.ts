import { create } from "zustand";
import type { PreviewVia } from "@/types";

/* Single shared <audio> element for iTunes previews. */
const audio =
  typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) {
  audio.preload = "auto";
  audio.volume = 0.8;
}

interface PlayerState {
  url: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  previewVia: PreviewVia | "loading" | "none";
  setPreviewVia: (v: PreviewVia | "loading" | "none") => void;
  load: (url: string | null, autoplay: boolean) => void;
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

  toggle: () => (get().playing ? get().pause() : get().play()),

  play: () => {
    if (!audio || !get().url) return;
    audio.play().catch(() => set({ playing: false }));
  },

  pause: () => {
    audio?.pause();
  },

  seekFraction: (f) => {
    if (!audio) return;
    const d = audio.duration || get().duration;
    audio.currentTime = Math.max(0, Math.min(1, f)) * d;
  },

  setVolume: (v) => {
    if (audio) audio.volume = v;
    set({ volume: v });
  },
}));

if (audio) {
  audio.addEventListener("timeupdate", () =>
    usePlayerStore.setState({ currentTime: audio.currentTime }),
  );
  audio.addEventListener("loadedmetadata", () =>
    usePlayerStore.setState({ duration: audio.duration || 30 }),
  );
  audio.addEventListener("play", () =>
    usePlayerStore.setState({ playing: true }),
  );
  audio.addEventListener("pause", () =>
    usePlayerStore.setState({ playing: false }),
  );
  audio.addEventListener("ended", () =>
    usePlayerStore.setState({ playing: false }),
  );
}
