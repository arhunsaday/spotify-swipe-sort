import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

if (import.meta.env.DEV) {
  // handy for debugging in the console: window.__sw.session.getState()
  void (async () => {
    const [auth, lib, session, player, ui] = await Promise.all([
      import("@/store/useAuthStore"),
      import("@/store/useLibraryStore"),
      import("@/store/useSessionStore"),
      import("@/store/usePlayerStore"),
      import("@/store/useUiStore"),
    ]);
    (window as unknown as { __sw: unknown }).__sw = {
      auth: auth.useAuthStore,
      lib: lib.useLibraryStore,
      session: session.useSessionStore,
      player: player.usePlayerStore,
      ui: ui.useUiStore,
    };
  })();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <Toaster />
  </React.StrictMode>,
);
