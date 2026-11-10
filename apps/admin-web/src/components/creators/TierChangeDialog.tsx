'use client';

import { useEffect, useId, useRef } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { dangerButtonClass, smallButtonClass } from '@/components/content/parts';

/** The confirm button of a non-destructive change: the accent colour, at the dialog's button size. */
export const confirmButtonClass =
  'inline-flex items-center justify-center px-3 py-2 rounded bg-accent hover:bg-accent-hover text-on-accent text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus disabled:opacity-60 disabled:cursor-not-allowed';

export interface TierChangeDialogProps {
  open: boolean;
  title: string;
  /** What the change does ("can upload up to N per hour…") */
  body: string;
  /** A second paragraph that needs attention (removing a tier, a super admin) */
  warning?: string | null;
  confirmLabel: string;
  danger?: boolean;
  testId: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The confirmation of a tier change: a modal <dialog> (focus trapped, Esc
 * cancels, the confirm button has focus) stating its effect, opened by the row's tier select, the "Make
 * Creator" button or the bulk bar.
 */
export function TierChangeDialog({ open, title, body, warning, confirmLabel, danger = false, testId, onCancel, onConfirm }: TierChangeDialogProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => open && onCancel()}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-body`}
      className="m-auto bg-surface text-fg border border-border rounded-lg p-0 w-[min(32rem,calc(100vw-2rem))] backdrop:bg-fg/50"
      data-testid={`${testId}-dialog`}
    >
      {/* No <form>: the dialog also opens inside the tier editor's form, and forms cannot nest */}
      <div className="p-6 space-y-4">
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${ids}-body`} className="text-fg-muted text-sm" data-testid={`${testId}-effect`}>
          {body}
        </p>
        {warning && (
          <p role="note" className="rounded border border-border border-s-4 border-s-accent bg-surface-2 px-3 py-2 text-sm text-fg" data-testid={`${testId}-warning`}>
            {warning}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={smallButtonClass} onClick={onCancel} data-testid={`${testId}-cancel`}>
            {t('content.cancel')}
          </button>
          <button type="button" autoFocus className={danger ? dangerButtonClass : confirmButtonClass} onClick={onConfirm} data-testid={`${testId}-confirm`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
