'use client';

/**
 * Renders the app-wide Undo toast (lib/undo-toast). A polite status region at the bottom end
 * corner, placed like the real-time toasts (notifications/realtime-toasts.css): above the phone tab
 * bar, under the header and modals: the message, Undo, and a close button. It goes after UNDO_TOAST_MS; hovering or
 * focusing it pauses the countdown so Undo is never pulled away from a keyboard or screen
 * reader user. Laid out by the page direction (Arabic: right to left).
 *
 * While it shows, the page gets the toast's own height of extra scroll room at its end, so the
 * last post (or row) can always be scrolled clear above the toast instead of sitting under it.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { BodyPortal } from '@/components/ui/BodyPortal';
import { useTextDirection } from '@/hooks/useTextDirection';
import { UNDO_TOAST_MS, dismissUndoToast, subscribeUndoToast, undoToastSnapshot } from '@/lib/undo-toast';

export default function UndoToastHost() {
  const toast = useSyncExternalStore(subscribeUndoToast, undoToastSnapshot, () => null);
  const dir = useTextDirection();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const left = useRef(UNDO_TOAST_MS);
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);

  // Scroll room under the page while the toast shows: its height plus the gap above the tab bar or edge
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) { setRoom(0); return; }
    const measure = () => setRoom(Math.ceil(el.getBoundingClientRect().height) + 16);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [toast?.id]);

  // A new toast starts fresh
  useEffect(() => {
    setBusy(false);
    setFailed(false);
    setPaused(false);
    left.current = UNDO_TOAST_MS;
  }, [toast?.id]);

  useEffect(() => {
    if (!toast || paused || busy) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissUndoToast(toast.id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(1500, left.current - (Date.now() - started));
    };
  }, [toast, paused, busy]);

  if (!toast) return null;

  const undo = async () => {
    if (!toast.undo) return;
    setBusy(true);
    setFailed(false);
    try {
      await toast.undo.run();
      dismissUndoToast(toast.id);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  const testId = toast.testId ?? 'undo-toast';
  return (
    <BodyPortal>
      <div aria-hidden="true" data-testid={`${testId}-room`} style={{ height: room }} />
      <div
        ref={box}
        dir={dir}
        role="status"
        aria-live="polite"
        data-testid={testId}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="fixed bottom-[calc(68px+env(safe-area-inset-bottom))] inset-x-4 z-[48] mx-auto flex max-w-md items-center gap-3 rounded-lg border border-[var(--fanous-c-dialog-border)] bg-[var(--fanous-c-dialog-bg)] px-4 py-3 text-start text-[var(--fanous-c-dialog-text)] shadow-lg lg:bottom-4 lg:inset-x-auto lg:end-4 lg:w-[360px]"
      >
        <p className="min-w-0 flex-1 text-sm font-medium">
          {failed && toast.undo ? toast.undo.failedMessage : toast.message}
        </p>
        {toast.undo && (
        <button
          type="button"
          onClick={undo}
          disabled={busy}
          className="shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--fanous-color-link)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-link)] disabled:opacity-70"
          data-testid={`${testId}-undo`}
        >
          {busy ? toast.undo.busyLabel : toast.undo.label}
        </button>
        )}
        <button
          type="button"
          onClick={() => dismissUndoToast(toast.id)}
          aria-label={toast.dismissLabel}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--fanous-c-dialog-muted)] hover:text-[var(--fanous-c-dialog-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-c-dialog-text)]"
          data-testid={`${testId}-dismiss`}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </BodyPortal>
  );
}
