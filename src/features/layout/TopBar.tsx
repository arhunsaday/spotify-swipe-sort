import { ChevronDown, Keyboard, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
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

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const sourceName =
    sourceId === LIKED_SOURCE_ID
      ? "Liked Songs"
      : (playlists.find((p) => p.id === sourceId)?.name ?? "Choose source");

  const pct = total > 0 ? ((index + 1) / total) * 100 : 0;

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border px-4">
      <div className="flex items-center gap-2 font-semibold">
        <img
          src="/icon.png"
          alt="Swiper"
          className="h-7 w-7 rounded-md drag-none"
          draggable={false}
        />
        <span className="hidden sm:inline">Spotify Swipe Sort</span>
      </div>

      <Button
        variant="secondary"
        size="sm"
        className="gap-2"
        onClick={() => openSetup(true)}
      >
        <span className="max-w-[40vw] truncate">{sourceName}</span>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </Button>

      {/* session progress */}
      <div className="hidden flex-1 items-center gap-3 md:flex">
        <Progress value={pct} className="h-1.5 max-w-xs" />
        <span className="whitespace-nowrap text-xs text-muted-foreground tabnum">
          {total > 0 ? `${index + 1} / ${total}` : "—"}
        </span>
        {filed > 0 && (
          <Badge variant="success" className="gap-1">
            <Sparkles className="h-3 w-3" /> {filed} changes
          </Badge>
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
