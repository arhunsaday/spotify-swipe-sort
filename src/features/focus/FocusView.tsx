import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Music2 } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/useSessionStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { prefetchPreviews, resolvePreview } from "@/lib/preview";
import type { SpotifyTrack } from "@/types";

/** Prefer a mid-size cover — the 640px original is wasted on a 340px box. */
function coverUrl(track: SpotifyTrack | null): string {
  if (!track) return "";
  return (
    track.album.images.find((i) => (i.width ?? 0) >= 300)?.url ??
    track.album.images[0]?.url ??
    ""
  );
}

export function FocusView() {
  const tracks = useSessionStore((s) => s.tracks);
  const index = useSessionStore((s) => s.index);
  const dir = useSessionStore((s) => s.dir);
  const status = useSessionStore((s) => s.status);
  const loaded = useSessionStore((s) => s.loaded);
  const total = useSessionStore((s) => s.total);
  const next = useSessionStore((s) => s.next);
  const prev = useSessionStore((s) => s.prev);
  const autoplay = useLibraryStore((s) => s.settings.previewAutoplay);

  const playing = usePlayerStore((s) => s.playing);
  const toggle = usePlayerStore((s) => s.toggle);
  const load = usePlayerStore((s) => s.load);
  const setPreviewVia = usePlayerStore((s) => s.setPreviewVia);
  const previewVia = usePlayerStore((s) => s.previewVia);

  const track = tracks[index] ?? null;
  const noPreview = previewVia === "none";
  const reqId = useRef(0);

  const cover = coverUrl(track);

  // resolve the preview whenever the current track changes
  useEffect(() => {
    if (!track) {
      load(null, false);
      setPreviewVia("none");
      return;
    }
    const id = ++reqId.current;
    setPreviewVia("loading");
    resolvePreview(track).then((res) => {
      if (id !== reqId.current) return; // stale
      setPreviewVia(res.url ? res.via : "none");
      load(res.url, autoplay);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  // warm the next few tracks so → is instant: iTunes lookup + cover image.
  // Debounced so holding the arrow key doesn't queue a lookup per track.
  useEffect(() => {
    const upcoming = tracks.slice(index + 1, index + 4);
    if (upcoming.length === 0) return;
    const t = window.setTimeout(() => {
      void prefetchPreviews(upcoming);
      for (const u of upcoming) {
        const url = coverUrl(u);
        if (url) new Image().src = url;
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [tracks, index]);

  if (status === "loading") {
    return (
      <Centered>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground tabnum">
          {total > 0
            ? `Loading source… ${loaded} / ${total}`
            : "Loading source…"}
        </p>
      </Centered>
    );
  }

  if (status === "ready" && tracks.length === 0) {
    return (
      <Centered>
        <Music2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Nothing to sort in this source.
        </p>
      </Centered>
    );
  }

  if (!track) {
    return (
      <Centered>
        <Music2 className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Pick a source to start sorting.
        </p>
      </Centered>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* blurred album-art backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <AnimatePresence>
          {cover && (
            <motion.img
              key={cover}
              src={cover}
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeInOut" }}
              className="absolute left-1/2 top-1/2 h-[150%] w-[150%] -translate-x-1/2 -translate-y-1/2 object-cover blur-[100px] saturate-[1.4]"
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-background/75" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" />
      </div>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={track.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 56 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -56 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full flex-col items-center"
          >
            <div
              className={cn(
                "aspect-square w-full max-w-[clamp(160px,38vh,340px)] overflow-hidden rounded-2xl border border-white/10 shadow-[0_28px_90px_-28px_rgba(0,0,0,0.85)] transition-[filter,opacity] duration-300",
                noPreview && "opacity-70 grayscale",
              )}
            >
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  className="h-full w-full object-cover drag-none"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-secondary">
                  <Music2 className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
            </div>

            <h1 className="mt-5 line-clamp-2 text-center text-3xl font-bold tracking-tight hover:text-white/60">
              <a
                href={`https://open.spotify.com/track/${track.id}`}
                target="_blank"
                rel="noreferrer"
                title="Open in Spotify"
                className="cursor-pointer text-inherit no-underline outline-none"
              >
                {track.name}
              </a>
            </h1>
            <p className="mt-1 text-center text-lg text-muted-foreground">
              <a
                href={`https://open.spotify.com/artist/${track.artists[0].id}`}
                target="_blank"
                rel="noreferrer"
                title="Open in Spotify"
                className="cursor-pointer text-inherit no-underline outline-none hover:text-white/80"
              >
                {track.artists.map((a) => a.name).join(", ")}
              </a>
            </p>
            <p className="mt-0.5 text-center text-sm text-muted-foreground/70">
              {track.album.name}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* transport */}
        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            onClick={prev}
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full"
            onClick={toggle}
            disabled={noPreview}
            title={noPreview ? "No preview available" : undefined}
            aria-label="Play/pause"
          >
            {playing ? (
              <MaterialSymbolsPauseRounded className="h-7 w-7" />
            ) : (
              <MaterialSymbolsPlayArrowRounded className="h-7 w-7" />
            )}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={next}
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      {children}
    </div>
  );
}

export function MaterialSymbolsPlayArrowRounded(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      {/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712"
      />
    </svg>
  );
}

export function MaterialSymbolsPauseRounded(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      {/* Icon from Material Symbols by Google - https://github.com/google/material-design-icons/blob/master/LICENSE */}
      <path
        fill="currentColor"
        d="M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19"
      />
    </svg>
  );
}
