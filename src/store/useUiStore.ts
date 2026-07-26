import { create } from "zustand";

interface UiState {
  setupOpen: boolean;
  helpOpen: boolean;
  setSetupOpen: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
  toggleHelp: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  setupOpen: false,
  helpOpen: false,
  setSetupOpen: (v) => set({ setupOpen: v }),
  setHelpOpen: (v) => set({ helpOpen: v }),
  toggleHelp: () => set({ helpOpen: !get().helpOpen }),
}));
