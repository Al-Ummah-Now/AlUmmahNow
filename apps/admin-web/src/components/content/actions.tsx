'use client';

/**
 * Client helpers for content changes: run a server action, show a localized
 * error (from the admin-api error code), refresh the page on success, and a
 * confirm dialog for destructive or user-visible changes.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { dangerButtonClass, smallButtonClass } from './parts';
import { confirmMatches } from './userPickerModel';

export function useContentAction() {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function describe(result: Extract<ActionResult<unknown>, { ok: false }>): string {
    if (result.status === 401) return t('errors.notAuthenticated');
    if (result.status === 403 && !result.code) return t('content.errors.forbidden');
    if (result.code) {
      const key = `content.errors.${result.code}` as MessageKey;
      const text = t(key);
      if (text !== key) return text;
    }
    return t('content.failed', { error: result.error });
  }

  /** Runs one change; returns its data, or null when it failed (the error is shown). */
  async function run<T>(name: string, action: () => Promise<ActionResult<T>>, opts: { refresh?: boolean; success?: string } = {}): Promise<T | null> {
    setBusy(name);
    setError(null);
    setMessage(null);
    let result: ActionResult<T>;
    try {
      result = await action();
    } catch (e) {
      logger.error('[content] Action request failed', { name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      logger.warn('[content] Action failed', { name, status: result.status, code: result.code });
      setError(describe(result));
      return null;
    }
    if (opts.success) setMessage(opts.success);
    if (opts.refresh !== false) router.refresh();
    return result.data;
  }

  return { run, busy, error, message, setError, setMessage };
}

/**
 * The outcome of the last change. It scrolls itself into view when it changes:
 * a result shown above the fold (the button was further down) reads as
 * "nothing happened".
 */
export function ActionFeedback({ error, message, testId }: { error: string | null; message: string | null; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error && !message) return;
    const el = ref.current;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [error, message]);
  return (
    <div aria-live="polite" ref={ref} data-testid={testId}>
      {error && (
        <p role="alert" data-testid="content-action-error" className="bg-danger-bg border border-danger-border text-danger-fg px-3 py-2 rounded text-sm mb-3">
          {error}
        </p>
      )}
      {message && (
        <p data-testid="content-action-message" className="text-success-fg text-sm mb-3">
          {message}
        </p>
      )}
    </div>
  );
}

interface ConfirmDialogContent {
  title: string;
  body: string;
  confirmLabel: string;
  /** Asks for a reason (sent with the change). */
  withReason?: boolean;
  /** Help under the reason field (default: shown to the owner). */
  reasonHint?: string;
  /** The exact text the admin must type to enable the confirm button. */
  /** The text the admin must type to enable the confirm button; with several, any one of them (emails ignore case). */
  typeToConfirm?: string | readonly string[];
  /** Label of the type-to-confirm field (default: "Type {value} to confirm"). */
  typeToConfirmLabel?: string;
  danger?: boolean;
  testId: string;
}

interface ConfirmDialogProps extends ConfirmDialogContent {
  open: boolean;
  /** Esc, the backdrop and Cancel all call this. */
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/** True when the typed text matches the required value (surrounding spaces ignored). */
export function typedMatches(typed: string, required: string | readonly string[] | undefined): boolean {
  const values = confirmValuesOf(required);
  return values.length === 0 || confirmMatches(typed, values);
}

/** The accepted type-to-confirm values (none when nothing has to be typed). */
function confirmValuesOf(required: string | readonly string[] | undefined): string[] {
  if (required === undefined) return [];
  return (typeof required === 'string' ? [required] : [...required]).map((v) => v.trim()).filter(Boolean);
}

/**
 * Modal <dialog> (showModal: focus trap, Escape cancels) to confirm a change.
 * Focus starts on Cancel, or on the reason / type-to-confirm field when there is one.
 * Never use window.confirm/alert/prompt instead.
 */
export function ConfirmDialog({ open, onCancel, onConfirm, title, body, confirmLabel, withReason, reasonHint, typeToConfirm, typeToConfirmLabel, danger, testId }: ConfirmDialogProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmValues = confirmValuesOf(typeToConfirm);
  const ids = useId();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (!withReason && confirmValues.length === 0) cancelRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, withReason, confirmValues.length]);

  const ready = typedMatches(typed, typeToConfirm);
  const reset = () => {
    setReason('');
    setTyped('');
  };
  const cancel = () => {
    reset();
    onCancel();
  };

  return (
    <dialog
      ref={ref}
      // Escape fires `cancel` synchronously: move to closed then, so an Enter on the
      // opening button right after reopens it. `close` arrives a task later; it only
      // cancels when nothing reopened the dialog meanwhile.
      onCancel={() => cancel()}
      onClose={() => {
        if (open && !ref.current?.open) cancel();
      }}
      onClick={(e) => {
        // A click on the backdrop (outside the form) cancels
        if (e.target === e.currentTarget) cancel();
      }}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-body`}
      className="m-auto bg-surface text-fg border border-border rounded-lg p-0 w-[min(32rem,calc(100vw-2rem))] backdrop:bg-fg/50"
      data-testid={`${testId}-dialog`}
    >
      <form
        method="dialog"
        className="p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const text = reason.trim();
          reset();
          onConfirm(text);
        }}
      >
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${ids}-body`} className="text-fg-muted text-sm">
          {body}
        </p>
        {withReason && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-reason`} className="text-sm text-fg-muted">
              {t('content.reason')}
            </label>
            <textarea id={`${ids}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} dir="auto" className={`${fieldClass} w-full`} data-testid={`${testId}-reason`} />
            <span className="text-xs text-fg-subtle">{reasonHint ?? t('content.reasonHint')}</span>
          </div>
        )}
        {confirmValues.length > 0 && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-typed`} className="text-sm text-fg-muted">
              {typeToConfirmLabel ?? t('content.typeToConfirm', { value: confirmValues[0] })}
            </label>
            <input id={`${ids}-typed`} value={typed} onChange={(e) => setTyped(e.target.value)} dir="auto" autoComplete="off" className={`${fieldClass} w-full`} data-testid={`${testId}-typed`} data-confirm={confirmValues[0]} />
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button ref={cancelRef} type="button" className={smallButtonClass} onClick={cancel} data-testid={`${testId}-cancel`}>
            {t('content.cancel')}
          </button>
          <button type="submit" className={danger ? dangerButtonClass : smallButtonClass} disabled={!ready} data-testid={`${testId}-confirm`}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

interface ConfirmProps extends ConfirmDialogContent {
  /** Opens the dialog. */
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}

/** A button that opens a modal <dialog> to confirm (and optionally explain) a change. */
export function ConfirmButton({ label, disabled, busy, onConfirm, ...dialog }: ConfirmProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={dialog.danger ? dangerButtonClass : smallButtonClass} disabled={disabled || busy} onClick={() => setOpen(true)} data-testid={dialog.testId}>
        {busy ? t('content.working') : label}
      </button>
      <ConfirmDialog
        {...dialog}
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={(reason) => {
          setOpen(false);
          void onConfirm(reason);
        }}
      />
    </>
  );
}

/**
 * Imperative confirm for handlers that are not a single button:
 * `if (!(await confirm({...}))) return;`. Render `dialog` once in the component.
 */
export function useConfirm() {
  const [content, setContent] = useState<ConfirmDialogContent | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmDialogContent) => {
    // A second request while one is open cancels the first
    resolver.current?.(false);
    setContent(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setContent(null);
    resolve?.(confirmed);
  }, []);

  const dialog = content ? <ConfirmDialog {...content} open onCancel={() => settle(false)} onConfirm={() => settle(true)} /> : null;
  return { confirm, dialog };
}

/** A row's Delete (comment, playlist, post): a soft delete, restorable for 30 days under Recently deleted, with an optional reason. */
export function DeleteRowButton({ title, body, testId, onDelete }: { title: string; body: string; testId: string; onDelete: (reason?: string) => Promise<ActionResult<unknown>> }) {
  const { t } = useLanguage();
  const { run, busy, error } = useContentAction();
  return (
    <div className="flex flex-col items-start gap-1">
      <ConfirmButton
        label={t('content.delete')}
        title={title}
        body={`${body} ${t('deleted.softNote')}`}
        confirmLabel={t('content.delete')}
        withReason
        reasonHint={t('deleted.reasonHint')}
        danger
        busy={busy === 'delete'}
        testId={testId}
        onConfirm={(reason) => run('delete', () => onDelete(reason || undefined), { success: t('deleted.movedToBin') })}
      />
      {error && (
        <span role="alert" className="text-danger-fg text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
