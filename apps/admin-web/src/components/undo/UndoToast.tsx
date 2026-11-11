'use client';

/**
 * Undo instead of confirm (owner decision): a reversible change (hide/unhide,
 * unpublish/republish, dismiss, tier change, restore, spam, error status) runs
 * at once and a toast offers "Undo" for about 8 seconds. Undo runs the inverse
 * change. The keyboard's `u` undoes the newest offer (never while typing in a
 * field). Toasts are announced politely in a live region, stack (newest last,
 * at most three) and pause while pointed at or focused.
 *
 * Deletes, bans, removals, transfers and permanent deletes keep the in-app
 * confirm dialog (components/content/actions.tsx).
 *
 *   const undoable = useUndoableAction();
 *   undoable.run({ action: () => hide(id), undo: () => unhide(id), message: t('...') });
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { listKeyAction } from '@/lib/list/keyboard';
import { latestUndoable, nextExpiry, undoReducer, type UndoToast } from '@/lib/list/undo';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';
import { AdminClientError } from '@/lib/list/api-client';

interface ShowOptions {
  message: string;
  undo: () => Promise<unknown>;
  /** What "Undone" says (default: the shared "Undone"). */
  undoneMessage?: string;
}

interface UndoContextValue {
  show: (options: ShowOptions) => string;
}

const UndoContext = createContext<UndoContextValue | null>(null);

let seq = 0;

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [toasts, dispatch] = useReducer(undoReducer, []);
  const handlers = useRef(new Map<string, ShowOptions>());
  const errors = useRef(new Map<string, string>());
  const paused = useRef(false);

  // One timer for the next toast to run out
  useEffect(() => {
    const at = nextExpiry(toasts);
    if (at === null) return;
    const timer = window.setTimeout(() => dispatch({ type: 'tick', now: Date.now() }), Math.max(0, at - Date.now()) + 20);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  // Forget the handlers of toasts that are gone
  useEffect(() => {
    const ids = new Set(toasts.map((x) => x.id));
    for (const id of [...handlers.current.keys()]) if (!ids.has(id)) handlers.current.delete(id);
  }, [toasts]);

  const undo = useCallback(
    async (id: string) => {
      const options = handlers.current.get(id);
      const toast = toasts.find((x) => x.id === id);
      if (!options || !toast || toast.status !== 'done') return;
      dispatch({ type: 'undoStart', id });
      try {
        await options.undo();
        dispatch({ type: 'undoSucceeded', id, now: Date.now() });
      } catch (error) {
        const status = error instanceof AdminClientError ? error.status : 0;
        const ref = status === 0 || status >= 500 ? reportError(error, { shown: true, status, extra: { where: 'undo' } }) : null;
        logger.warn('[undo] Undo failed', { status, ref });
        errors.current.set(id, ref ?? '');
        dispatch({ type: 'undoFailed', id });
      }
    },
    [toasts],
  );

  // `u` undoes the newest offer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (listKeyAction(e, document.activeElement as HTMLElement | null) !== 'undo') return;
      const latest = latestUndoable(toasts);
      if (!latest) return;
      e.preventDefault();
      void undo(latest.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toasts, undo]);

  const show = useCallback((options: ShowOptions) => {
    const id = `undo-${++seq}`;
    handlers.current.set(id, options);
    dispatch({ type: 'add', id, message: options.message, now: Date.now() });
    if (paused.current) dispatch({ type: 'pause', now: Date.now() });
    return id;
  }, []);

  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    dispatch({ type: 'pause', now: Date.now() });
  };
  const resume = (e?: React.FocusEvent) => {
    if (e && e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    paused.current = false;
    dispatch({ type: 'resume', now: Date.now() });
  };

  const value = useMemo(() => ({ show }), [show]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      <section
        aria-label={t('undo.region')}
        className="fixed z-50 inset-x-4 top-4 sm:top-auto sm:bottom-4 sm:inset-x-auto sm:end-4 sm:w-96 flex flex-col gap-2 pointer-events-none"
        onMouseEnter={pause}
        onMouseLeave={() => resume()}
        onFocus={pause}
        onBlur={resume}
        data-testid="undo-toasts"
      >
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {toasts.map((toast) => (
            <ToastItem
              key={toast.id}
              toast={toast}
              undoneMessage={handlers.current.get(toast.id)?.undoneMessage}
              errorRef={errors.current.get(toast.id)}
              onUndo={() => void undo(toast.id)}
              onDismiss={() => dispatch({ type: 'dismiss', id: toast.id })}
            />
          ))}
        </div>
      </section>
    </UndoContext.Provider>
  );
}

function ToastItem({ toast, undoneMessage, errorRef, onUndo, onDismiss }: { toast: UndoToast; undoneMessage?: string; errorRef?: string; onUndo: () => void; onDismiss: () => void }) {
  const { t } = useLanguage();
  const failed = toast.status === 'undoFailed';
  const text =
    toast.status === 'undone'
      ? (undoneMessage ?? t('undo.undone'))
      : failed
        ? errorRef
          ? t('undo.failedRef', { ref: errorRef })
          : t('undo.failed')
        : toast.message;
  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${failed ? 'bg-danger-bg border-danger-border text-danger-fg' : 'bg-surface border-border text-fg'}`}
      data-testid="undo-toast"
      data-status={toast.status}
    >
      <p className="flex-1 text-sm" role={failed ? 'alert' : undefined}>
        {text}
        {toast.status === 'done' && <span className="sr-only">. {t('undo.hint')}</span>}
      </p>
      {(toast.status === 'done' || toast.status === 'undoing') && (
        <button
          type="button"
          onClick={onUndo}
          disabled={toast.status === 'undoing'}
          aria-keyshortcuts="U"
          className="shrink-0 rounded px-2 py-1 text-sm font-semibold text-link hover:text-link-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
          data-testid="undo-toast-undo"
        >
          {toast.status === 'undoing' ? t('undo.undoing') : t('undo.undo')}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('undo.dismiss')}
        className="shrink-0 rounded px-1 text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        data-testid="undo-toast-dismiss"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export interface UndoableRun<R> {
  /** The change, run at once. */
  action: () => Promise<R>;
  /** Its inverse, run by Undo. */
  undo: (result: R) => Promise<unknown>;
  /** What happened ("Video unpublished"); a function gets the change's result. */
  message: string | ((result: R) => string);
  undoneMessage?: string;
}

/**
 * Runs a reversible change at once and offers Undo. Resolves with the change's
 * result; rejects (and shows no toast) when the change itself fails, so the
 * caller shows the error.
 */
export function useUndoableAction() {
  const context = useContext(UndoContext);
  const run = useCallback(
    async <R,>({ action, undo, message, undoneMessage }: UndoableRun<R>): Promise<R> => {
      const result = await action();
      const text = typeof message === 'function' ? message(result) : message;
      if (context) context.show({ message: text, undo: () => undo(result), undoneMessage });
      else logger.warn('[undo] No UndoToastProvider: the change ran without an undo offer');
      return result;
    },
    [context],
  );
  return { run };
}
