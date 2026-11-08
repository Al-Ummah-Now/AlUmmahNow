/**
 * Bulk edit of selected videos (Epic 5.3): visibility, category and tags.
 * Collects the form; the page sends it (POST /api/videos/bulk-update) and
 * reports the per-video results.
 */
'use client';

import React, { useEffect, useState } from 'react';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/hooks/useLanguage';
import {
  buildBulkChanges,
  CLEAR_CATEGORY,
  EMPTY_BULK_EDIT,
  type BulkEditForm,
  type BulkVideoChanges,
} from '@/lib/dashboard/bulk-edit';

interface BulkEditDialogProps {
  open: boolean;
  count: number;
  onOpenChange: (open: boolean) => void;
  /** Resolves when the request finished (the dialog closes on success). */
  onApply: (changes: BulkVideoChanges) => Promise<boolean>;
}

const fieldClass =
  'mt-1 block w-full min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 ' +
  'dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600';

export function BulkEditDialog({ open, count, onOpenChange, onApply }: BulkEditDialogProps) {
  const { t, lang, isRTL } = useLanguage();
  const b = t.bulkEdit;
  const [form, setForm] = useState<BulkEditForm>(EMPTY_BULK_EDIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_BULK_EDIT);
      setError(null);
    }
  }, [open]);

  const set = <K extends keyof BulkEditForm>(key: K, value: BulkEditForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const changes = buildBulkChanges(form);
    if (!changes) {
      setError(b.nothingToApply);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onApply(changes);
      if (ok) onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRTL ? 'rtl' : 'ltr'} data-testid="bulk-edit-dialog">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{b.title.replace('{count}', count.toLocaleString(lang === 'ar' ? 'ar' : 'en-US'))}</DialogTitle>
            <DialogDescription>{b.description}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <label className="block text-sm font-medium">
              {b.visibility}
              <select className={fieldClass} value={form.visibility} onChange={(e) => set('visibility', e.target.value as BulkEditForm['visibility'])} data-testid="bulk-edit-visibility">
                <option value="">{b.noChange}</option>
                <option value="public">{b.public}</option>
                <option value="private">{b.private}</option>
              </select>
            </label>

            <label className="block text-sm font-medium">
              {b.category}
              <select className={fieldClass} value={form.category} onChange={(e) => set('category', e.target.value)} data-testid="bulk-edit-category">
                <option value="">{b.noChange}</option>
                <option value={CLEAR_CATEGORY}>{b.clearCategory}</option>
                {VIDEO_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label[lang === 'ar' ? 'ar' : 'en']}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium">
              {b.addTags}
              <input className={fieldClass} value={form.addTags} onChange={(e) => set('addTags', e.target.value)} aria-describedby="bulk-edit-tags-hint" data-testid="bulk-edit-add-tags" />
            </label>

            <label className="block text-sm font-medium">
              {b.removeTags}
              <input className={fieldClass} value={form.removeTags} onChange={(e) => set('removeTags', e.target.value)} aria-describedby="bulk-edit-tags-hint" data-testid="bulk-edit-remove-tags" />
            </label>
            <p id="bulk-edit-tags-hint" className="text-xs text-gray-600 dark:text-gray-400">{b.tagsHint}</p>

            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="bulk-edit-error">{error}</p>
            )}
          </div>

          <DialogFooter className="mt-6 gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="min-h-11 rounded-md px-4 text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-700">
              {b.cancel}
            </button>
            <button type="submit" disabled={busy} data-testid="bulk-edit-apply" className="min-h-11 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60">
              {busy ? b.applying : b.apply}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default BulkEditDialog;
