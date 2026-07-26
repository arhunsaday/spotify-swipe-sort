import { useEffect } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import { useUiStore } from "@/store/useUiStore";
import { HOTKEYS } from "@/lib/hotkeys";

const HOTKEY_SET = new Set<string>(HOTKEYS);

/** Global keydown handler. The whole point of the app: keyboard-first sorting. */
export function useKeyboard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;

      const ui = useUiStore.getState();
      // when a dialog is open, let it own the keyboard
      if (ui.setupOpen || ui.helpOpen) {
        if (e.key === "?" ) ui.toggleHelp();
        return;
      }

      const session = useSessionStore.getState();
      const player = usePlayerStore.getState();

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (e.key === "ArrowRight" || key === "l") {
        session.next();
        e.preventDefault();
      } else if (e.key === "ArrowLeft" || key === "h") {
        session.prev();
        e.preventDefault();
      } else if (e.key === " ") {
        player.toggle();
        e.preventDefault();
      } else if (HOTKEY_SET.has(key)) {
        void session.fileToTarget(key);
        e.preventDefault();
      } else if (key === "z") {
        session.undoLast();
        e.preventDefault();
      } else if (e.key === "?") {
        ui.toggleHelp();
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
