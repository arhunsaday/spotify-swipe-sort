import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  disabled?: boolean;
  /** draw a divider above this item */
  divider?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
  /** extra classes for the wrapper that owns the trigger */
  className?: string;
  /** right-click at the cursor (default), or left-click anchored to the child */
  trigger?: "contextmenu" | "click";
  /** left-click triggers only: called when the menu opens, to refresh items */
  onOpen?: () => void;
}

/** Where the menu wants to sit. `flipTo` is the y to use instead when opening
 *  downward would run off-screen — set for anchored menus so a trigger in the
 *  bottom bar opens upward rather than covering itself. */
interface Pos {
  x: number;
  y: number;
  flipTo: number | null;
}

const PAD = 8;

/** Minimal right-click menu — portalled, viewport-clamped, keyboard-drivable.
 *  The wrapper (not the child) owns `contextmenu`, so it still fires when the
 *  child is a disabled button. */
export function ContextMenu({
  items,
  children,
  className,
  trigger = "contextmenu",
  onOpen,
}: ContextMenuProps) {
  const [pos, setPos] = React.useState<Pos | null>(null);
  const [active, setActive] = React.useState(0);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // refs so the key handler can stay subscribed across renders
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const activeRef = React.useRef(active);
  const select = React.useCallback((i: number) => {
    activeRef.current = i;
    setActive(i);
  }, []);

  const close = React.useCallback(() => setPos(null), []);
  const run = React.useCallback(
    (item: ContextMenuItem) => {
      if (item.disabled) return;
      close();
      item.onSelect();
    },
    [close],
  );

  const firstEnabled = () => items.findIndex((it) => !it.disabled);

  // keep the menu inside the viewport once we can measure it
  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (!pos || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(PAD, Math.min(pos.x, window.innerWidth - r.width - PAD));
    const overflows = pos.y + r.height > window.innerHeight - PAD;
    const wanted =
      overflows && pos.flipTo !== null ? pos.flipTo - r.height : pos.y;
    const y = Math.max(PAD, Math.min(wanted, window.innerHeight - r.height - PAD));
    if (x !== pos.x || y !== pos.y) setPos({ ...pos, x, y });
  }, [pos]);

  React.useEffect(() => {
    if (!pos) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };

    const step = (dir: 1 | -1) => {
      const list = itemsRef.current;
      let i = activeRef.current;
      for (let n = 0; n < list.length; n++) {
        i = (i + dir + list.length) % list.length;
        if (!list[i].disabled) break;
      }
      select(i);
    };

    // capture-phase: the menu owns the keyboard while open, so the app's
    // global hotkeys (space, arrows, 1-9…) don't fire behind it.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape" || e.key === "Tab") {
        close();
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        step(1);
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        step(-1);
        e.preventDefault();
      } else if (e.key === "Enter" || e.key === " ") {
        const item = itemsRef.current[activeRef.current];
        if (item) run(item);
        e.preventDefault();
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [pos, close, run, select]);

  return (
    <>
      <span
        className={cn("inline-flex", className)}
        onContextMenu={(e) => {
          if (trigger !== "contextmenu") return;
          e.preventDefault();
          select(Math.max(0, firstEnabled()));
          setPos({ x: e.clientX, y: e.clientY, flipTo: null });
        }}
        onClick={(e) => {
          if (trigger !== "click") return;
          if (pos) return close(); // second click on the trigger dismisses
          const r = e.currentTarget.getBoundingClientRect();
          select(Math.max(0, firstEnabled()));
          onOpen?.();
          setPos({ x: r.left, y: r.bottom + 4, flipTo: r.top - 4 });
        }}
      >
        {children}
      </span>

      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ left: pos.x, top: pos.y }}
            className="fixed z-50 min-w-52 animate-in fade-in-0 zoom-in-95 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            onContextMenu={(e) => e.preventDefault()}
          >
            {items.map((item, i) => (
              <React.Fragment key={item.label}>
                {item.divider && i > 0 && (
                  <div className="my-1 h-px bg-border" role="separator" />
                )}
                <button
                  role="menuitem"
                  type="button"
                  disabled={item.disabled}
                  onMouseEnter={() => !item.disabled && select(i)}
                  onClick={() => run(item)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
                    "disabled:pointer-events-none disabled:opacity-40",
                    i === active && "bg-accent text-accent-foreground",
                  )}
                >
                  {item.icon && (
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{item.label}</span>
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
