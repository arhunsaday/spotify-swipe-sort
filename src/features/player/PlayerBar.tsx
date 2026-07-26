import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatTime } from "@/lib/utils";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useSessionStore } from "@/store/useSessionStore";

export function PlayerBar() {
  const track = useSessionStore((s) => s.tracks[s.index] ?? null);
  const index = useSessionStore((s) => s.index);
  const total = useSessionStore((s) => s.tracks.length);
  const next = useSessionStore((s) => s.next);
  const prev = useSessionStore((s) => s.prev);
  const goTo = useSessionStore((s) => s.goTo);

  const {
    playing,
    currentTime,
    duration,
    volume,
    previewVia,
    toggle,
    seekFraction,
    setVolume,
  } = usePlayerStore();

  const cover = track?.album.images.at(-1)?.url ?? track?.album.images[0]?.url;
  const pct = duration ? (currentTime / duration) * 100 : 0;
  const noPreview = previewVia === "none";

  const fs = useFullscreen();

  return (
    <div className="flex h-20 items-center gap-4 border-t border-border bg-card/80 px-4 backdrop-blur">
      {/* now playing */}
      <div className="flex w-0 flex-1 items-center gap-3 sm:w-56 sm:flex-none">
        {cover ? (
          <img
            src={cover}
            alt=""
            className={cn(
              "h-11 w-11 rounded-md border border-border object-cover drag-none transition-[filter,opacity] duration-300",
              noPreview && "opacity-70 grayscale",
            )}
            draggable={false}
          />
        ) : (
          <div className="h-11 w-11 rounded-md bg-secondary" />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {track ? (
              <a
                href={`https://open.spotify.com/track/${track.id}`}
                target="_blank"
                rel="noreferrer"
                title="Open in Spotify"
                className="cursor-pointer text-inherit no-underline"
              >
                {track.name}
              </a>
            ) : (
              "—"
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {track?.artists.map((a) => a.name).join(", ") ?? ""}
          </p>
        </div>
      </div>

      {/* transport + scrubber */}
      <div className="flex flex-[2] items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={prev}
          disabled={!track}
          aria-label="Previous track"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={toggle}
          disabled={!track || noPreview}
          title={noPreview ? "No preview available" : undefined}
          aria-label="Play/pause"
        >
          {playing ? (
            <Pause className="h-8 w-8" />
          ) : (
            <Play className="h-8 w-4" />
          )}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={next}
          disabled={!track}
          aria-label="Next track"
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
        <span className="ml-1 w-9 text-right text-xs text-muted-foreground tabnum">
          {formatTime(currentTime)}
        </span>
        <Slider
          value={[pct]}
          max={100}
          step={0.1}
          onValueChange={([v]) => seekFraction(v / 100)}
          className="flex-1"
          aria-label="Seek"
        />
        <span className="w-9 text-xs text-muted-foreground tabnum">
          {formatTime(duration)}
        </span>
      </div>

      {/* right cluster: jump · volume · fullscreen */}
      <div className="ml-auto flex items-center gap-3">
        {/* <PreviewBadge via={previewVia} /> */}

        {total > 0 && (
          <div className="hidden items-center gap-1 text-xs text-muted-foreground md:flex">
            <input
              key={index}
              type="number"
              min={1}
              max={total}
              defaultValue={index + 1}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = parseInt((e.target as HTMLInputElement).value, 10);
                  if (!Number.isNaN(n)) goTo(n - 1);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) goTo(n - 1);
              }}
              className="h-7 w-11 rounded-md border border-border bg-background/50 px-1 text-center tabnum text-foreground outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="Jump to track number"
            />
            <span className="tabnum">/ {total}</span>
          </div>
        )}

        <div className="hidden items-center gap-2 lg:flex lg:w-28">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            aria-label="Mute"
          >
            {volume > 0 ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
          <Slider
            value={[volume * 100]}
            max={100}
            onValueChange={([v]) => setVolume(v / 100)}
            className="flex-1"
            aria-label="Volume"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleFullscreen}
              aria-label="Toggle fullscreen"
            >
              {fs ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {fs ? "Exit fullscreen" : "Fullscreen"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen?.();
  }
}

function useFullscreen() {
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const h = () => setFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);
  return fs;
}
