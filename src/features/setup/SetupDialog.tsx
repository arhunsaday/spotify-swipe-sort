import { useEffect, useMemo, useState } from "react";
import {
  Heart,
  ListMusic,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import type { Settings } from "@/store/useLibraryStore";
import { MAX_TARGETS } from "@/lib/hotkeys";
import { clearAllCaches } from "@/lib/cache";

export function SetupDialog() {
  const open = useUiStore((s) => s.setupOpen);
  const setOpen = useUiStore((s) => s.setSetupOpen);

  const playlists = useLibraryStore((s) => s.playlists);
  const loading = useLibraryStore((s) => s.loadingPlaylists);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);
  const sourceId = useLibraryStore((s) => s.sourceId);
  const setSource = useLibraryStore((s) => s.setSource);
  const targets = useLibraryStore((s) => s.targets);
  const toggleTarget = useLibraryStore((s) => s.toggleTarget);

  const [q, setQ] = useState("");

  useEffect(() => {
    if (open && playlists.length === 0) void loadPlaylists();
  }, [open, playlists.length, loadPlaylists]);

  const filtered = useMemo(
    () =>
      playlists.filter((p) =>
        p.name.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [playlists, q],
  );

  const targetKey = (id: string) => targets.find((t) => t.id === id)?.key;
  const targetsFull = (id: string) =>
    targets.length >= MAX_TARGETS && !targetKey(id);

  /** Throw away every cached list and re-read everything from Spotify. */
  const hardRefresh = async () => {
    await clearAllCaches();
    await loadPlaylists(true);
    const sid = useLibraryStore.getState().sourceId;
    if (sid) void useSessionStore.getState().loadSource(sid, { force: true });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[86vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle>Set up your session</DialogTitle>
          <DialogDescription>
            Pick a source to triage, then choose target playlists — each gets a
            hotkey.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 px-6 pb-6">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search playlists"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => void hardRefresh()}
            disabled={loading}
            aria-label="Refresh from Spotify"
            title="Refresh from Spotify — clears the local cache and re-reads everything"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-border scrollbar-thin">
          <div className="space-y-1 p-3">
            {/* Liked Songs — usable as a source *and* as a target */}
            {"liked songs".includes(q.trim().toLowerCase()) && (
              <Row
                title="Liked Songs"
                subtitle="your saved tracks"
                icon={
                  <Heart className="h-5 w-5 text-primary stroke-[0.2rem]" />
                }
                isSource={sourceId === LIKED_SOURCE_ID}
                onSource={() => setSource(LIKED_SOURCE_ID)}
                targetKey={targetKey(LIKED_SOURCE_ID)}
                onToggleTarget={() =>
                  toggleTarget({ id: LIKED_SOURCE_ID, name: "Liked Songs" })
                }
                targetsFull={targetsFull(LIKED_SOURCE_ID)}
              />
            )}

            {filtered.map((p) => (
              <Row
                key={p.id}
                title={p.name}
                subtitle={`${p.tracks.total} tracks · ${p.owner.display_name ?? p.owner.id}`}
                imageUrl={p.images?.[0]?.url}
                isSource={sourceId === p.id}
                onSource={() => setSource(p.id)}
                targetKey={targetKey(p.id)}
                onToggleTarget={() =>
                  toggleTarget({
                    id: p.id,
                    name: p.name,
                    imageUrl: p.images?.[0]?.url,
                  })
                }
                targetsFull={targetsFull(p.id)}
              />
            ))}

            {!loading && filtered.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No playlists match “{q}”.
              </p>
            )}
          </div>
        </div>

        <SettingsSection />

        <div className="flex justify-end p-4">
          <Button onClick={() => setOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row(props: {
  title: string;
  subtitle: string;
  imageUrl?: string;
  icon?: React.ReactNode;
  isSource: boolean;
  onSource: () => void;
  targetKey?: string;
  onToggleTarget?: () => void;
  targetsFull?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-transparent p-2 transition-colors hover:bg-accent",
        props.isSource && "border-primary/40 bg-primary/5",
      )}
    >
      {props.imageUrl ? (
        <img
          src={props.imageUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-md object-cover drag-none"
          draggable={false}
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
          {props.icon ?? (
            <ListMusic className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{props.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {props.subtitle}
        </p>
      </div>

      <Button
        variant={props.isSource ? "default" : "outline"}
        size="sm"
        onClick={props.onSource}
      >
        {props.isSource ? "Source" : "Set source"}
      </Button>

      {props.onToggleTarget && (
        <Button
          variant={props.targetKey ? "secondary" : "ghost"}
          size="sm"
          className="min-w-[84px]"
          onClick={props.onToggleTarget}
          disabled={props.targetsFull}
          title={props.targetsFull ? `Max ${MAX_TARGETS} targets` : undefined}
        >
          {props.targetKey ? (
            <>
              <Kbd className="mr-1 h-5 min-w-5">{props.targetKey}</Kbd> target
            </>
          ) : (
            <>
              <Plus className="mr-1 h-4 w-4" /> target
            </>
          )}
        </Button>
      )}
    </div>
  );
}

function SettingsSection() {
  const settings = useLibraryStore((s) => s.settings);
  const setSetting = useLibraryStore((s) => s.setSetting);

  const rows: {
    key: keyof Settings;
    label: string;
    hint: string;
  }[] = [
    {
      key: "autoAdvance",
      label: "Auto-advance",
      hint: "Jump to the next track after filing one.",
    },
    {
      key: "reverse",
      label: "Reverse order",
      hint: "Go through the source last-added first, instead of first-added.",
    },
    {
      key: "onlyUnfiled",
      label: "Only unsorted tracks",
      hint: "Hide tracks that are already in one of your target playlists.",
    },
    {
      key: "batchMode",
      label: "Batch mode",
      hint: "Queue adds/removes and apply them together (avoids the dev-mode quota)",
    },
    {
      key: "moveMode",
      label: "Move (remove from source)",
      hint: "Filing also removes the track from the source (ignored in batch mode)",
    },
    {
      key: "previewAutoplay",
      label: "Autoplay preview",
      hint: "Start the preview automatically on each track.",
    },
  ];

  return (
    <div className="space-y-3 p-6">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{r.label}</p>
            <p className="text-xs text-muted-foreground">{r.hint}</p>
          </div>
          <Switch
            checked={settings[r.key]}
            onCheckedChange={(v) => setSetting(r.key, v)}
          />
        </div>
      ))}
    </div>
  );
}
