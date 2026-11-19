/**
 * The app-wide Undo toast (owner rule: undo over confirm). A reversible action (a soft delete,
 * restorable for 30 days) happens at once and offers Undo here instead of asking first. One toast
 * at a time: a new one replaces the last. The host (components/common/UndoToastHost) is mounted
 * once in the locale layout, so the toast outlives the card or page that started it.
 */

export interface UndoToastOptions {
  message: string;
  dismissLabel: string;
  /** Without it the toast is a plain notice (e.g. the action failed) */
  undo?: {
    label: string;
    /** Shown while run() is busy */
    busyLabel: string;
    /** Shown when run() throws; the toast stays so Undo can be tried again */
    failedMessage: string;
    /** Restores what the action changed. Throws on failure. */
    run: () => Promise<void>;
  };
  testId?: string;
}

export interface UndoToastState extends UndoToastOptions {
  id: number;
}

/** How long the toast stays (ms); hovering or focusing it pauses the countdown. */
export const UNDO_TOAST_MS = 10_000;

let current: UndoToastState | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function showUndoToast(options: UndoToastOptions): number {
  current = { ...options, id: nextId++ };
  emit();
  return current.id;
}

export function dismissUndoToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function subscribeUndoToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const undoToastSnapshot = (): UndoToastState | null => current;
