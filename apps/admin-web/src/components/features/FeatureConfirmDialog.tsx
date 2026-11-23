'use client';

/**
 * Asks before a switch whose `confirm` covers the direction (wiki AUN-FEATURES §3): names the
 * feature, repeats its help text, lists the features that go off with it and, for caption
 * downloads, the owner's decision. Focus starts on Cancel (owner rule: the safe choice first).
 * A modal <dialog>: Escape and the backdrop cancel. Never window.confirm.
 */
import { useEffect, useId, useRef } from 'react';
import { featureDefinition } from '@al-ummah/shared-types';
import type { ConfirmContent } from '@/lib/features/page-model';
import { useLanguage } from '@/i18n/I18nProvider';
import { dangerButtonClass, primarySmallButtonClass, smallButtonClass } from '@/components/content/parts';
import { Icon } from '@/components/shell/icons';
import { formatDate } from '@/i18n/translate';

/** The owner's decision that viewers don't download captions (wiki AUN-FEATURES, QF1) */
const OWNER_DECISION_DATE = '2026-11-22T12:00:00Z';

export function FeatureConfirmDialog({ content, onCancel, onConfirm }: { content: ConfirmContent | null; onCancel: () => void; onConfirm: (c: ConfirmContent) => void }) {
  const { t, locale } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const open = content !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const def = content ? featureDefinition(content.key) : null;
  const name = def?.name[locale] ?? '';
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-help`}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60"
      data-testid="feature-confirm-dialog"
      data-key={content?.key ?? ''}
      data-next={content ? String(content.next) : ''}
    >
      {content && def && (
        <form
          method="dialog"
          className="space-y-5 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(content);
          }}
        >
          <h2 id={`${ids}-title`} className="text-xl font-semibold [text-wrap:balance]">
            {t(content.next ? 'features.confirm.titleOn' : 'features.confirm.titleOff', { name })}
          </h2>
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{t('features.confirm.loses')}</p>
            <p id={`${ids}-help`} className="mt-1 text-sm text-fg [text-wrap:pretty]" data-testid="feature-confirm-help">
              {def.help[locale]}
            </p>
          </div>
          {content.dependants.length > 0 && (
            <div data-testid="feature-confirm-dependants">
              <p className="text-sm font-medium text-fg">{t('features.confirm.dependants')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {content.dependants.map((k) => (
                  <li key={k} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-sm text-fg" data-key={k}>
                    {featureDefinition(k).name[locale]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {content.ownerDecision && (
            <p className="flex gap-2 rounded-lg border border-border bg-chip-reviewing-bg p-3 text-sm text-fg" data-testid="feature-confirm-owner">
              <Icon name="flag" className="mt-0.5 size-4 shrink-0" />
              <span>{t('features.confirm.ownerDecision', { date: formatDate(OWNER_DECISION_DATE, locale) })}</span>
            </p>
          )}
          <p className="text-sm text-fg-muted">{t('features.confirm.everyone')}</p>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button ref={cancelRef} type="button" className={smallButtonClass} onClick={onCancel} data-testid="feature-confirm-cancel">
              {t('common.cancel')}
            </button>
            <button type="submit" className={content.next ? primarySmallButtonClass : dangerButtonClass} data-testid="feature-confirm-ok">
              {t(content.next ? 'features.confirm.switchOn' : 'features.confirm.switchOff')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
