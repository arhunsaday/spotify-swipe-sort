/** Target hotkeys in press order: 1–9, then the QWERTY top row.
 *  Deliberately excludes keys already bound for navigation/undo (h, l, z). */
export const HOTKEYS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "q", "w", "e", "r", "t", "y", "u", "i", "o", "p",
] as const;

export const MAX_TARGETS = HOTKEYS.length;
