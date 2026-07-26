import { motion } from "framer-motion";
import { Check, ListMusic, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store/useLibraryStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useUiStore } from "@/store/useUiStore";

export function TargetRail() {
  const targets = useLibraryStore((s) => s.targets);
  const openSetup = useUiStore((s) => s.setSetupOpen);
  const membership = useSessionStore((s) => s.membership);
  const perTarget = useSessionStore((s) => s.stats.perTarget);
  const file = useSessionStore((s) => s.fileToTarget);
  const current = useSessionStore((s) => s.tracks[s.index] ?? null);

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
        <ScrollArea className="flex-1">
          <ul className="space-y-1 px-2 pb-4">
            {targets.map((tg) => {
              const isIn = current ? membership[tg.id]?.has(current.id) : false;
              const count = perTarget[tg.id] ?? 0;
              return (
                <motion.li
                  key={tg.id}
                  whileTap={{ scale: 0.97 }}
                  className="list-none"
                >
                  <button
                    onClick={() => void file(tg.key)}
                    disabled={!current}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition-colors",
                      "hover:border-border hover:bg-accent disabled:opacity-40",
                      isIn && "border-success/30 bg-success/5",
                    )}
                  >
                    <Kbd large>{tg.key}</Kbd>
                    {tg.imageUrl ? (
                      <img
                        src={tg.imageUrl}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md object-cover drag-none"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{tg.name}</p>
                      {count > 0 && (
                        <p className="text-xs text-muted-foreground tabnum">
                          +{count} this session
                        </p>
                      )}
                    </div>
                    {isIn && (
                      <Check className="h-4 w-4 shrink-0 text-success" />
                    )}
                  </button>
                </motion.li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
