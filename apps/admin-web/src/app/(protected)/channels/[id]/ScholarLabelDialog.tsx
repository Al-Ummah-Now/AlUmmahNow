'use client';

/**
 * Grant, change or remove a channel's verified (scholar) label (wiki Epic 21 §4 21.3, owner
 * decision E21-D4). Admins only. A reason is always required and stays internal (the audit
 * history); a grant names the kind: scholar or institution. An in-app modal <dialog>, never a
 * browser prompt; focus starts on Cancel so Enter never confirms by accident.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { dangerButtonClass, primarySmallButtonClass, smallButtonClass } from '@/components/content/parts';

export type LabelKind = 'scholar' | 'institution';
export type LabelMode = 'grant' | 'change' | 'remove';

const REASON_MAX = 500;

interface Props {
  open: boolean;
  mode: LabelMode;
  currentKind: LabelKind | null;
  onCancel: () => void;
  onConfirm: (reason: string, kind: LabelKind | undefined) => void;
}

export function ScholarLabelDialog({ open, mode, currentKind, onCancel, onConfirm }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<LabelKind | null>(currentKind);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason('');
      setKind(mode === 'change' ? (currentKind === 'scholar' ? 'institution' : 'scholar') : currentKind);
      dialog.showModal();
      cancelRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, mode, currentKind]);

  const removing = mode === 'remove';
  const ready = reason.trim().length > 0 && (removing || kind !== null);
  const title = t(removing ? 'channels.labelRemoveTitle' : mode === 'change' ? 'channels.labelChangeTitle' : 'channels.labelGrantTitle');
  const body = t(removing ? 'channels.labelRemoveBody' : 'channels.labelGrantBody');

  return (
    <dialog
      ref={ref}
      onCancel={() => onCancel()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-body`}
      className="m-auto bg-surface text-fg border border-border rounded-lg p-0 w-[min(32rem,calc(100vw-2rem))] backdrop:bg-fg/50"
      data-testid="scholar-label-dialog"
    >
      <form
        method="dialog"
        className="p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onConfirm(reason.trim(), removing ? undefined : (kind ?? undefined));
        }}
      >
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={`${ids}-body`} className="text-fg-muted text-sm [text-wrap:balance]">
          {body}
        </p>
        {!removing && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm text-fg-muted mb-1">{t('channels.labelKind')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(['scholar', 'institution'] as const).map((value) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 rounded border px-3 py-2 min-h-11 cursor-pointer text-sm ${kind === value ? 'border-accent bg-surface-2 text-fg' : 'border-border text-fg-muted'}`}
                >
                  <input type="radio" name={`${ids}-kind`} value={value} checked={kind === value} onChange={() => setKind(value)} data-testid={`scholar-label-kind-${value}`} />
                  {t(value === 'scholar' ? 'channels.kindScholar' : 'channels.kindInstitution')}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-reason`} className="text-sm text-fg-muted">
            {t('channels.labelReason')}
          </label>
          <textarea
            id={`${ids}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={REASON_MAX}
            required
            aria-required="true"
            dir="auto"
            className={`${fieldClass} w-full`}
            data-testid="scholar-label-reason"
          />
          <span className="text-xs text-fg-subtle">{t('channels.labelReasonHint')}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button ref={cancelRef} type="button" className={smallButtonClass} onClick={onCancel} data-testid="scholar-label-cancel">
            {t('content.cancel')}
          </button>
          <button type="submit" className={removing ? dangerButtonClass : primarySmallButtonClass} disabled={!ready} data-testid="scholar-label-confirm">
            {t(removing ? 'channels.labelRemove' : mode === 'change' ? 'channels.labelChange' : 'channels.labelGrant')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
