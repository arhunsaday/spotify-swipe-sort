import { useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Check, GripVertical, Heart, ListMusic, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { isAllowedKey } from "@/lib/hotkeys";
import { LIKED_SOURCE_ID, useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";
import type { Target } from "@/types";

export function TargetRail() {
  const targets = useLibraryStore((s) => s.targets);
  const reorderTargets = useLibraryStore((s) => s.reorderTargets);
  const openSetup = useUiStore((s) => s.setSetupOpen);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Targets
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => openSetup(true)}
          aria-label="Edit targets"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {targets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <ListMusic className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No target playlists yet.
          </p>
          <Button variant="secondary" size="sm" onClick={() => openSetup(true)}>
            Add targets
          </Button>
        </div>
      ) : (
        <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4">
          <Reorder.Group
            axis="y"
            values={targets}
            onReorder={reorderTargets}
            className="space-y-1"
          >
            {targets.map((tg) => (
              <TargetRow key={tg.id} tg={tg} />
            ))}
          </Reorder.Group>
        </div>
      )}
    </div>
  );
}

function TargetRow({ tg }: { tg: Target }) {
  const controls = useDragControls();
  const setTargetKey = useLibraryStore((s) => s.setTargetKey);
  const batchMode = useLibraryStore((s) => s.settings.batchMode);
  const file = useSessionStore((s) => s.fileToTarget);
  const membership = useSessionStore((s) => s.membership);
  const perTarget = useSessionStore((s) => s.stats.perTarget);
  const current = useSessionStore((s) => s.tracks[s.index] ?? null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isIn = current ? membership[tg.id]?.has(current.id) : false;
  const count = perTarget[tg.id] ?? 0;

  return (
    <Reorder.Item
      value={tg}
      dragListener={false}
      dragControls={controls}
      // Transforms go through Framer, colour and shadow stay in CSS. `whileDrag`
      // can't restore a background that came from a class — it has no origin
      // value to animate back to, so the inline one stuck after the drop.
      whileDrag={{ scale: 1.03 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1.5 transition-colors",
        "hover:border-border hover:bg-accent",
        isIn && "border-success/30 bg-success/5",
        dragging &&
          "bg-popover shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] hover:bg-popover",
      )}
    >
      {editing ? (
        <input
          autoFocus
          onKeyDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
            if (k === "Escape") return setEditing(false);
            if (isAllowedKey(k)) {
              setTargetKey(tg.id, k);
              setEditing(false);
            }
          }}
          onBlur={() => setEditing(false)}
          className="kbd kbd-lg w-8 text-center uppercase text-primary outline-none ring-2 ring-primary"
          aria-label={`Press a key to rebind ${tg.name}`}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          title="Click, then press any key to rebind"
          className="shrink-0"
        >
          <Kbd
            large
            className="uppercase hover:border-primary hover:text-primary"
          >
            {tg.key || "–"}
          </Kbd>
        </button>
      )}

      <button
        onClick={() => void file(tg.key)}
        disabled={!current}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-40"
      >
        {tg.imageUrl ? (
          <img
            src={tg.imageUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-md object-cover drag-none"
            draggable={false}
          />
        ) : tg.id === LIKED_SOURCE_ID ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15">
            <Heart className="h-5 w-5 text-primary stroke-[0.2rem]" />
          </div>
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
            <ListMusic className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tg.name}</p>
          {count > 0 && (
            <p className="text-xs text-muted-foreground tabnum">
              +{count} {batchMode ? "queued" : "filed"}
            </p>
          )}
        </div>
        {isIn && <Check className="h-4 w-4 shrink-0 text-success" />}
      </button>

      <button
        onPointerDown={(e) => controls.start(e)}
        className="shrink-0 cursor-grab touch-none text-muted-foreground/30 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </Reorder.Item>
  );
}
