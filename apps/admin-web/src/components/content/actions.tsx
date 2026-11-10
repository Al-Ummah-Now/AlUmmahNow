'use client';

/**
 * Client helpers for content changes: run a server action, show a localized
 * error (from the admin-api error code), refresh the page on success, and a
 * confirm dialog for destructive or user-visible changes.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { dangerButtonClass, smallButtonClass } from './parts';

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

export function ActionFeedback({ error, message }: { error: string | null; message: string | null }) {
  return (
    <div aria-live="polite">
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

interface ConfirmProps {
  /** Opens the dialog. */
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  /** Asks for a reason (sent with the change). */
  withReason?: boolean;
  /** The exact text the admin must type to enable the confirm button. */
  typeToConfirm?: string;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  testId: string;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}

/** A button that opens a modal <dialog> to confirm (and optionally explain) a change. */
export function ConfirmButton({ label, title, body, confirmLabel, withReason, typeToConfirm, danger, disabled, busy, testId, onConfirm }: ConfirmProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const ready = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <>
      <button type="button" className={danger ? dangerButtonClass : smallButtonClass} disabled={disabled || busy} onClick={() => setOpen(true)} data-testid={testId}>
        {busy ? t('content.working') : label}
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        aria-labelledby={`${ids}-title`}
        aria-describedby={`${ids}-body`}
        className="bg-surface text-fg border border-border rounded-lg p-0 w-[min(32rem,calc(100vw-2rem))] backdrop:bg-fg/50"
        data-testid={`${testId}-dialog`}
      >
        <form
          method="dialog"
          className="p-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            setOpen(false);
            await onConfirm(reason.trim());
            setReason('');
            setTyped('');
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
              <span className="text-xs text-fg-subtle">{t('content.reasonHint')}</span>
            </div>
          )}
          {typeToConfirm && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-typed`} className="text-sm text-fg-muted">
                {t('content.typeToConfirm', { value: typeToConfirm })}
              </label>
              <input id={`${ids}-typed`} value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" autoComplete="off" className={`${fieldClass} w-full`} data-testid={`${testId}-typed`} data-confirm={typeToConfirm} />
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className={smallButtonClass} onClick={() => setOpen(false)}>
              {t('content.cancel')}
            </button>
            <button type="submit" className={danger ? dangerButtonClass : smallButtonClass} disabled={!ready} data-testid={`${testId}-confirm`}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Delete button for a list row (comment, playlist, post): confirm, delete, refresh. */
export function DeleteRowButton({ title, body, testId, onDelete }: { title: string; body: string; testId: string; onDelete: () => Promise<ActionResult<unknown>> }) {
  const { t } = useLanguage();
  const { run, busy, error } = useContentAction();
  return (
    <div className="flex flex-col items-start gap-1">
      <ConfirmButton label={t('content.delete')} title={title} body={body} confirmLabel={t('content.delete')} danger busy={busy === 'delete'} testId={testId} onConfirm={() => run('delete', onDelete)} />
      {error && (
        <span role="alert" className="text-danger-fg text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
