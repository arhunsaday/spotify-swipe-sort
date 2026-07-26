/** Default auto-assign order for new targets: 1–9, 0, then the QWERTY top row.
 *  Users can rebind to any letter/digit except the reserved nav keys below. */
export const HOTKEYS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
  "q", "w", "e", "r", "t", "y", "u", "i", "o", "p",
] as const;

export const MAX_TARGETS = HOTKEYS.length;

/** Keys owned by global navigation/undo — never bindable to a target. */
export const RESERVED_KEYS = new Set(["h", "l", "z"]);

/** Any single lowercase letter or digit is bindable, except reserved nav keys. */
export function isAllowedKey(k: string): boolean {
  return /^[a-z0-9]$/.test(k) && !RESERVED_KEYS.has(k);
}
