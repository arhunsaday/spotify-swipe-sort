import { useMemo } from "react";
import {
  Check,
  ChevronDown,
  Heart,
  Keyboard,
  ListMusic,
  LogOut,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { countPending, useSessionStore } from "@/store/useSessionStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useUiStore } from "@/store/useUiStore";

export function TopBar() {
  const sourceId = useLibraryStore((s) => s.sourceId);
  const playlists = useLibraryStore((s) => s.playlists);
  const openSetup = useUiStore((s) => s.setSetupOpen);
  const toggleHelp = useUiStore((s) => s.toggleHelp);

  const index = useSessionStore((s) => s.index);
  const total = useSessionStore((s) => s.tracks.length);
  const filed = useSessionStore((s) => s.stats.filed);
  const membership = useSessionStore((s) => s.membership);
  const baseMembership = useSessionStore((s) => s.baseMembership);
  const applyPending = useSessionStore((s) => s.applyPending);

  const targets = useLibraryStore((s) => s.targets);
  const batchMode = useLibraryStore((s) => s.settings.batchMode);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const pending = useMemo(
    () => countPending(baseMembership, membership, targets),
    [baseMembership, membership, targets],
  );

  const isLiked = sourceId === LIKED_SOURCE_ID;
  const sourcePlaylist = playlists.find((p) => p.id === sourceId);
  const sourceName = isLiked
    ? "Liked Songs"
    : (sourcePlaylist?.name ?? "Choose a source");
  const sourceImage = sourcePlaylist?.images?.[0]?.url;

  const pct = total > 0 ? ((index + 1) / total) * 100 : 0;

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border px-4">
      {/* <img
        src="/icon.png"
        alt="Spotify Swipe Sort"
        className="h-7 w-7 shrink-0 rounded-md drag-none"
        draggable={false}
      /> */}
      {/* <div className="h-6 w-px bg-border" /> */}

      <button
        onClick={() => openSetup(true)}
        className="group -my-1 flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2.5 transition-colors hover:bg-accent"
      >
        {isLiked ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15">
            <Heart className="h-4 w-4 text-primary" />
          </div>
        ) : sourceImage ? (
          <img
            src={sourceImage}
            alt=""
            className="h-9 w-9 rounded-md object-cover drag-none"
            draggable={false}
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <ListMusic className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="text-left leading-tight">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Source
          </div>
          <div className="flex items-center gap-1">
            <span className="max-w-[32vw] truncate text-sm font-semibold">
              {sourceName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      </button>

      {/* session progress */}
      <div className="hidden flex-1 items-center gap-3 md:flex">
        <Progress value={pct} className="h-1.5 max-w-xs" />
        <span className="whitespace-nowrap text-xs text-muted-foreground tabnum">
          {total > 0 ? `${index + 1} / ${total}` : "—"}
        </span>
        {batchMode ? (
          pending > 0 && (
            <Button
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => void applyPending()}
            >
              <Check className="h-3.5 w-3.5" />
              Apply {pending}
              <Kbd className="h-4 min-w-4 border-b-0 bg-white/15 px-1 text-[10px] text-primary-foreground">
                ↵
              </Kbd>
            </Button>
          )
        ) : (
          filed > 0 && (
            <Badge variant="success" className="gap-1">
              <Sparkles className="h-3 w-3" /> {filed} changes
            </Badge>
          )
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {user && user.product !== "premium" && (
          <Badge variant="warning">Non premium account</Badge>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => toggleHelp()}
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Shortcuts (<span className="font-mono">?</span>)
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Log out {user?.display_name ?? ""}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
