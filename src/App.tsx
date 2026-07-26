import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { TopBar } from "@/features/layout/TopBar";
import { FocusView } from "@/features/focus/FocusView";
import { TargetRail } from "@/features/targets/TargetRail";
import { PlayerBar } from "@/features/player/PlayerBar";
import { SetupDialog } from "@/features/setup/SetupDialog";
import { HelpDialog } from "@/features/help/HelpDialog";
import { useAuthStore } from "@/store/useAuthStore";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import { useKeyboard } from "@/hooks/useKeyboard";
import { onQuotaExceeded } from "@/api/client";

let didInit = false; // survive React 18 StrictMode double-mount (OAuth code is single-use)

export default function App() {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);

  const playlists = useLibraryStore((s) => s.playlists);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);
  const sourceId = useLibraryStore((s) => s.sourceId);
  const targets = useLibraryStore((s) => s.targets);
  const reverse = useLibraryStore((s) => s.settings.reverse);
  const onlyUnfiled = useLibraryStore((s) => s.settings.onlyUnfiled);

  const loadSource = useSessionStore((s) => s.loadSource);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);

  const setSetupOpen = useUiStore((s) => s.setSetupOpen);

  useKeyboard(status === "authed");

  useEffect(() => {
    if (didInit) return;
    didInit = true;
    void init();
    onQuotaExceeded(() =>
      toast.warning("Spotify quota exceeded — slowing down", {
        id: "quota",
        description: "Dev-mode apps share a quota bucket. Try again shortly.",
      }),
    );
  }, [init]);

  // once authed, load the playlist library
  useEffect(() => {
    if (status === "authed" && playlists.length === 0) void loadPlaylists();
  }, [status, playlists.length, loadPlaylists]);

  // no source chosen yet -> prompt setup
  useEffect(() => {
    if (status === "authed" && !sourceId) setSetupOpen(true);
  }, [status, sourceId, setSetupOpen]);

  // (re)load the deck when the source changes
  useEffect(() => {
    if (status === "authed" && sourceId) void loadSource(sourceId);
  }, [status, sourceId, loadSource]);

  // prefetch membership for any newly-added target
  useEffect(() => {
    if (status === "authed" && sourceId) void refreshMembership();
  }, [status, sourceId, targets, refreshMembership]);

  // rebuild the deck when order/filter settings change mid-session
  useEffect(() => {
    const s = useSessionStore.getState();
    if (s.allTracks.length) s.applyView();
  }, [reverse, onlyUnfiled]);

  if (status === "loading") return <Splash />;
  if (status !== "authed") return <LoginScreen />;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            <FocusView />
          </main>
          <aside className="hidden w-72 shrink-0 border-l border-border lg:block xl:w-80">
            <TargetRail />
          </aside>
        </div>
        <PlayerBar />
      </div>
      <SetupDialog />
      <HelpDialog />
    </TooltipProvider>
  );
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
