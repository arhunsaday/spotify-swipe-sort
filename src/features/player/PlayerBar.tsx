import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  Laptop,
  Loader2,
  Maximize2,
  MonitorSpeaker,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Speaker,
  Timer,
  Volume2,
  VolumeX,
  Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatTime } from "@/lib/utils";
import { playOnDevice, toggleFullTracks } from "@/lib/playback";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { getDevices, type SpotifyDevice } from "@/api/spotify";
import type { SpotifyTrack } from "@/types";

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
    sdkStatus,
    toggle,
    play,
    seekFraction,
    setVolume,
  } = usePlayerStore();

  const fullTracks = useLibraryStore((s) => s.settings.fullTracks);
  const cover = track?.album.images.at(-1)?.url ?? track?.album.images[0]?.url;
  const pct = duration ? (currentTime / duration) * 100 : 0;
  const noPreview = previewVia === "none";

  const fs = useFullscreen();

  const spotifyUrl = track ? `https://open.spotify.com/track/${track.id}` : "";
  const transportMenu: ContextMenuItem[] = [
    {
      label: playing ? "Pause preview" : "Play preview",
      icon: playing ? Pause : Play,
      onSelect: toggle,
      disabled: !track || noPreview,
    },
    {
      label: "Restart preview",
      icon: RotateCcw,
      onSelect: () => {
        seekFraction(0);
        play();
      },
      disabled: !track || noPreview,
    },
    {
      label: "Open on Spotify web",
      icon: ExternalLink,
      divider: true,
      onSelect: () => window.open(spotifyUrl, "_blank", "noopener,noreferrer"),
      disabled: !track,
    },
    {
      label: "Open in Spotify app",
      icon: Play,
      onSelect: () => {
        if (track) window.location.href = track.uri; // spotify:track:<id>
      },
      disabled: !track,
    },
    {
      label: "Copy Spotify link",
      icon: Link2,
      divider: true,
      onSelect: () => void copy(spotifyUrl, "link"),
      disabled: !track,
    },
    {
      label: "Copy title & artist",
      icon: Copy,
      onSelect: () =>
        void copy(
          track
            ? `${track.artists.map((a) => a.name).join(", ")} — ${track.name}`
            : "",
          "track",
        ),
      disabled: !track,
    },
  ];

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
                className="cursor-pointer text-inherit no-underline hover:text-white/80"
              >
                {track.name}
              </a>
            ) : (
              "—"
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <a
              href={`https://open.spotify.com/artist/${track?.artists[0].id}`}
              target="_blank"
              rel="noreferrer"
              title="Open in Spotify"
              className="cursor-pointer text-inherit no-underline hover:text-white/80"
            >
              {track?.artists.map((a) => a.name).join(", ") ?? ""}
            </a>
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
        <ContextMenu items={transportMenu}>
          <Button
            size="icon"
            variant="secondary"
            onClick={toggle}
            disabled={!track || noPreview}
            title={
              noPreview
                ? "No preview available — right-click for more"
                : "Right-click for more options"
            }
            aria-haspopup="menu"
            aria-label="Play/pause"
          >
            {playing ? (
              <MaterialSymbolsPauseRounded className="h-6 w-6" />
            ) : (
              <MaterialSymbolsPlayArrowRounded className="h-6 w-6" />
            )}
          </Button>
        </ContextMenu>
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
        <SourceToggle
          full={fullTracks}
          connecting={sdkStatus === "connecting"}
        />
        <DevicePicker track={track} />

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

/** One button, two states. It's a mode you flip mid-session, so it lives in
 *  the bar rather than in settings. */
function SourceToggle({
  full,
  connecting,
}: {
  full: boolean;
  connecting: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={full}
      onClick={toggleFullTracks}
      title={
        full
          ? "Whole track in this tab — click for 30s previews (F)"
          : "30s preview — click for whole tracks in this tab (F)"
      }
      className={cn(
        "hidden h-7 gap-1.5 px-2 text-sm sm:inline-flex",
        full ? "" : "",
      )}
    >
      {connecting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : full ? (
        <Music className="h-4 w-4" />
      ) : (
        <Timer className="h-4 w-4" />
      )}
      {full ? "Full track" : "Preview"}
    </Button>
  );
}

/** Spotify reports a free-form `type`; these are the ones that actually show up. */
function deviceIcon(type: string) {
  const t = type.toLowerCase();
  if (t === "smartphone" || t === "tablet") return Smartphone;
  if (t === "speaker" || t === "avr" || t === "stb") return Speaker;
  if (t === "computer") return Laptop;
  return MonitorSpeaker;
}

/** Picks where the current track plays. Devices are re-fetched on every open —
 *  they appear and vanish as clients wake and sleep, so a cached list lies. */
function DevicePicker({ track }: { track: SpotifyTrack | null }) {
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    getDevices()
      .then(setDevices)
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  };

  let items: ContextMenuItem[];
  if (loading && !devices) {
    items = [
      { label: "Looking for devices…", onSelect: () => {}, disabled: true },
    ];
  } else if (devices && devices.length > 0) {
    items = devices.map((d) => ({
      label: d.is_active ? `${d.name} · active` : d.name,
      icon: deviceIcon(d.type),
      disabled: !d.id || d.is_restricted || !track,
      onSelect: () => {
        if (track) void playOnDevice(track, d);
      },
    }));
  } else {
    items = [
      { label: "No Spotify device found", onSelect: () => {}, disabled: true },
      {
        label: "Open the Spotify app",
        icon: ExternalLink,
        onSelect: () => {
          if (track) window.location.href = track.uri;
        },
        disabled: !track,
      },
    ];
  }

  return (
    <ContextMenu items={items} trigger="click" onOpen={refresh}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-haspopup="menu"
        title="Play on another device"
      >
        <MonitorSpeaker className="h-[18px] w-[18px]" />
      </Button>
    </ContextMenu>
  );
}

async function copy(text: string, what: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}`);
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
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

export function MaterialSymbolsPlayArrowRounded(
  props: React.SVGProps<SVGSVGElement>,
) {
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

export function MaterialSymbolsPauseRounded(
  props: React.SVGProps<SVGSVGElement>,
) {
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
