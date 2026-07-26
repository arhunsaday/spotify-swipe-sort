import { Command } from "cmdk";
import {
  ArrowLeft,
  ArrowRight,
  ListPlus,
  Pause,
  Play,
  Repeat,
  Undo2,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useUiStore } from "@/store/useUiStore";
import { useSessionStore } from "@/store/useSessionStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useLibraryStore } from "@/store/useLibraryStore";

export function HelpDialog() {
  const open = useUiStore((s) => s.helpOpen);
  const setOpen = useUiStore((s) => s.setHelpOpen);
  const openSetup = useUiStore((s) => s.setSetupOpen);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  const session = useSessionStore.getState;
  const player = usePlayerStore.getState;
  const lib = useLibraryStore.getState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-hidden p-0" hideClose>
        <Command className="[&_[cmdk-input]]:h-12">
          <Command.Input
            placeholder="Search actions & shortcuts…"
            className="w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No matching action.
            </Command.Empty>

            <Group heading="Navigate">
              <Item
                icon={<ArrowRight className="h-4 w-4" />}
                label="Next track"
                keys={["→", "l"]}
                onSelect={() => run(() => session().next())}
              />
              <Item
                icon={<ArrowLeft className="h-4 w-4" />}
                label="Previous track"
                keys={["←", "h"]}
                onSelect={() => run(() => session().prev())}
              />
            </Group>

            <Group heading="Playback">
              <Item
                icon={
                  player().playing ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )
                }
                label="Play / pause preview"
                keys={["Space"]}
                onSelect={() => run(() => player().toggle())}
              />
            </Group>

            <Group heading="Sort">
              <Item
                icon={<ListPlus className="h-4 w-4" />}
                label="File to target playlist"
                keys={["1", "…", "9"]}
                onSelect={() => run(() => openSetup(true))}
              />
              <Item
                icon={<Undo2 className="h-4 w-4" />}
                label="Undo last action"
                keys={["z"]}
                onSelect={() => run(() => session().undoLast())}
              />
              <Item
                icon={<Repeat className="h-4 w-4" />}
                label={`Auto-advance: ${lib().settings.autoAdvance ? "on" : "off"}`}
                onSelect={() =>
                  run(() =>
                    lib().setSetting("autoAdvance", !lib().settings.autoAdvance),
                  )
                }
              />
              <Item
                icon={<ListPlus className="h-4 w-4" />}
                label="Change source / edit targets"
                onSelect={() => run(() => openSetup(true))}
              />
            </Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Group({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  icon,
  label,
  keys,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  keys?: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-accent"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      {keys && (
        <span className="flex items-center gap-1">
          {keys.map((k, i) => (
            <Kbd key={i}>{k}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );
}
