'use client';

/**
 * Sticky bar at the bottom of a settings page while it has unsaved drafts:
 * "{n} unsaved changes", Discard, Save changes. After a save it briefly
 * confirms "Changes saved". Also warns before leaving the page with drafts.
 */

import React, { useEffect } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { cn } from '@/lib/utils';

interface UnsavedChangesBarProps {
  /** Number of changed fields; 0 hides the bar (unless `saved` or `error`) */
  count: number;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
  /** False when a field is invalid; the bar explains why Save is off */
  canSave?: boolean;
  /** Shows "Changes saved" in place of the counter */
  saved?: boolean;
  /** Error from the last save */
  error?: string | null;
  /** Extra content on the saved state, e.g. a "View channel" link */
  savedAction?: React.ReactNode;
  /** data-testid of the Save button */
  saveTestId?: string;
}

export function UnsavedChangesBar({ count, onSave, onDiscard, saving = false, canSave = true, saved = false, error, savedAction, saveTestId = 'unsaved-changes-save' }: UnsavedChangesBarProps) {
  const { t, dir } = useLanguage();
  useUnsavedChangesGuard(count > 0);

  const visible = count > 0 || saved || !!error;
  if (!visible) return null;

  const message = error
    ? error
    : count === 0
      ? t.inlineEdit.saved
      : !canSave
        ? t.inlineEdit.fixErrors
        : count === 1
          ? t.inlineEdit.unsavedOne
          : t.inlineEdit.unsavedMany.replace('{count}', String(count));

  return (
    <div className="sticky bottom-0 inset-x-0 z-40 pointer-events-none px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2" dir={dir}>
      <div
        role="region"
        aria-label={t.inlineEdit.saveChanges}
        className={cn(
          'unsaved-bar-enter pointer-events-auto mx-auto max-w-3xl flex flex-wrap items-center gap-x-3 gap-y-2',
          'rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_12px_40px_-12px_rgba(0,0,0,0.45)] ps-4 pe-2 py-2',
          count > 0 && 'border-s-4 border-s-[var(--inline-edit-ring)]'
        )}
        data-testid="unsaved-changes-bar"
        data-state={error ? 'error' : count === 0 ? 'saved' : canSave ? 'dirty' : 'invalid'}
      >
        <p className="flex items-center gap-2 text-sm font-medium min-w-0 flex-1 py-1.5" role="status" aria-live="polite">
          {error ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-[var(--inline-edit-error)]" aria-hidden="true" />
          ) : count === 0 ? (
            <Check className="w-4 h-4 shrink-0 text-[var(--inline-edit-success)]" aria-hidden="true" />
          ) : (
            <span className="w-2 h-2 shrink-0 rounded-full bg-[var(--inline-edit-ring)]" aria-hidden="true" />
          )}
          <span className={cn(error && 'text-[var(--inline-edit-error)]')} data-testid="unsaved-changes-message">{message}</span>
        </p>
        {count === 0 ? (
          savedAction
        ) : (
          <div className="flex items-center gap-2 ms-auto">
            <button
              type="button"
              onClick={onDiscard}
              disabled={saving}
              className="min-h-11 px-4 rounded-xl text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              data-testid="unsaved-changes-discard"
            >
              {t.inlineEdit.discard}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !canSave}
              className="inline-flex items-center gap-2 min-h-11 px-5 rounded-xl text-sm font-semibold bg-primary text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={saveTestId}
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {saving ? t.inlineEdit.saving : t.inlineEdit.saveChanges}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Asks before closing or reloading the tab while there are unsaved drafts. */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

export default UnsavedChangesBar;
