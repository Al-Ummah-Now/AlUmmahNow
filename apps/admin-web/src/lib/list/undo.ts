/**
 * The undo toast's state machine (owner rule: reversible changes act at once
 * and offer Undo instead of asking first).
 *
 *   done ──undo──▶ undoing ──ok──▶ undone ──(shortly)──▶ gone
 *     │                   └──fail──▶ undoFailed ──(dismiss)──▶ gone
 *     └──(about 8 s, or dismissed)──▶ gone
 *
 * Toasts stack: the newest is last, at most MAX_TOASTS are kept (the oldest
 * finished one goes first) and `u` undoes the newest one still undoable. The
 * timer pauses while the pointer or focus is on the toasts, so nobody loses an
 * Undo they are reaching for. Pure: the provider drives it with timers.
 */

export type UndoStatus = 'done' | 'undoing' | 'undone' | 'undoFailed';

export interface UndoToast {
  id: string;
  /** What happened, e.g. "Video unpublished". */
  message: string;
  status: UndoStatus;
  /** When the Undo offer ends (ms since epoch); paused toasts keep their remaining time. */
  expiresAt: number;
  /** Set while paused: the time that was left. */
  remainingMs: number | null;
}

export const UNDO_WINDOW_MS = 8_000;
/** How long "Undone" stays before it goes. */
export const UNDONE_LINGER_MS = 2_500;
export const MAX_TOASTS = 3;

export type UndoEvent =
  | { type: 'add'; id: string; message: string; now: number; windowMs?: number }
  | { type: 'undoStart'; id: string }
  | { type: 'undoSucceeded'; id: string; now: number }
  | { type: 'undoFailed'; id: string }
  | { type: 'dismiss'; id: string }
  | { type: 'tick'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number };

function update(toasts: readonly UndoToast[], id: string, fn: (t: UndoToast) => UndoToast): UndoToast[] {
  return toasts.map((t) => (t.id === id ? fn(t) : t));
}

/** Keeps the newest MAX_TOASTS, dropping finished ones before ones still undoable. */
function cap(toasts: UndoToast[]): UndoToast[] {
  const out = [...toasts];
  while (out.length > MAX_TOASTS) {
    const finished = out.findIndex((t) => t.status !== 'done' && t.status !== 'undoing');
    out.splice(finished >= 0 ? finished : 0, 1);
  }
  return out;
}

export function undoReducer(toasts: readonly UndoToast[], event: UndoEvent): UndoToast[] {
  switch (event.type) {
    case 'add':
      return cap([
        ...toasts.filter((t) => t.id !== event.id),
        { id: event.id, message: event.message, status: 'done', expiresAt: event.now + (event.windowMs ?? UNDO_WINDOW_MS), remainingMs: null },
      ]);
    case 'undoStart':
      // Only an offer still open can be taken; a second press while it runs does nothing
      return update(toasts, event.id, (t) => (t.status === 'done' ? { ...t, status: 'undoing' } : t));
    case 'undoSucceeded':
      return update(toasts, event.id, (t) => (t.status === 'undoing' ? { ...t, status: 'undone', expiresAt: event.now + UNDONE_LINGER_MS, remainingMs: null } : t));
    case 'undoFailed':
      // Stays until dismissed: the admin has to know the change was not undone
      return update(toasts, event.id, (t) => (t.status === 'undoing' ? { ...t, status: 'undoFailed', remainingMs: null } : t));
    case 'dismiss':
      // An undo in flight finishes first (its result is announced)
      return toasts.filter((t) => t.id !== event.id || t.status === 'undoing');
    case 'tick':
      return toasts.filter((t) => t.status === 'undoing' || t.status === 'undoFailed' || t.remainingMs !== null || t.expiresAt > event.now);
    case 'pause':
      return toasts.map((t) => (t.remainingMs === null && (t.status === 'done' || t.status === 'undone') ? { ...t, remainingMs: Math.max(0, t.expiresAt - event.now) } : t));
    case 'resume':
      return toasts.map((t) => (t.remainingMs !== null ? { ...t, expiresAt: event.now + Math.max(t.remainingMs, 1_500), remainingMs: null } : t));
    default:
      return toasts as UndoToast[];
  }
}

/** The toast `u` undoes: the newest whose offer is still open. */
export function latestUndoable(toasts: readonly UndoToast[]): UndoToast | null {
  for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i].status === 'done') return toasts[i];
  return null;
}

/** When the next toast runs out (for the provider's timer), or null when nothing is timed. */
export function nextExpiry(toasts: readonly UndoToast[]): number | null {
  const timed = toasts.filter((t) => (t.status === 'done' || t.status === 'undone') && t.remainingMs === null).map((t) => t.expiresAt);
  return timed.length ? Math.min(...timed) : null;
}
