/**
 * Upload queue "Set values": first values for all queued files or the ticked
 * ones (title pattern, description, category, language, visibility,
 * playlists, tags, publish time, comments). Setting, not editing: values a
 * creator typed on a file are kept unless "Overwrite my changes" is ticked.
 * Values set for all files also go to files picked afterwards.
 */
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import type { OrderKey, RenameSubject, TitleLanguage } from '@al-ummah/shared-types';
import { emptyBulkForm, readyFields, renamePreview, type BulkField, type BulkFormState } from '@/lib/bulk-edit/form';
import { BulkDrawer } from '@/components/bulkEdit/BulkDrawer';
import { BulkFieldsForm, type PlaylistSource } from '@/components/bulkEdit/BulkFieldsForm';

/** Files not uploaded yet have no upload date, publish date or duration to sort by */
export const UPLOAD_ORDER_KEYS: OrderKey[] = ['list', 'title', 'filename'];

export const UPLOAD_SET_FIELDS: BulkField[] = ['title', 'description', 'category', 'language', 'visibility', 'playlists', 'tags', 'schedule', 'comments'];

export type SetScope = 'all' | 'selected';

interface BatchSetValuesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All queued files that can take values, in queue order */
  all: RenameSubject[];
  /** The ticked ones */
  selected: RenameSubject[];
  /** The values last set for all files (start from them) */
  initial?: BulkFormState | null;
  playlists?: PlaylistSource | null;
  knownTags?: string[];
  onApply: (form: BulkFormState, scope: SetScope, overwrite: boolean) => void;
  /** Titles already on the channel ("Continue numbering after") */
  loadExistingTitles?: () => Promise<string[]>;
}

export function BatchSetValuesPanel({ open, onOpenChange, all, selected, initial, playlists, knownTags = [], onApply, loadExistingTitles }: BatchSetValuesPanelProps) {
  const { t, lang } = useLanguage();
  const b = t.bulkEdit;
  const ui: TitleLanguage = lang === 'ar' ? 'ar' : 'en';
  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en-US');
  const [form, setForm] = useState<BulkFormState>(() => initial ?? emptyBulkForm(ui));
  const [scope, setScope] = useState<SetScope>(selected.length ? 'selected' : 'all');
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? { ...initial, rename: { ...initial.rename, excluded: [] } } : emptyBulkForm(ui));
    setScope(selected.length ? 'selected' : 'all');
    setOverwrite(false);
    // Reset when the panel opens only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const subjects = scope === 'selected' ? selected : all;
  const preview = useMemo(() => (form.ticked.includes('title') ? renamePreview(form, subjects) : undefined), [form, subjects]);
  // Before any file is picked, a pattern still applies to the files picked next
  const ready = readyFields(form, subjects.length ? preview : undefined);

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className="b b-secondary" onClick={() => onOpenChange(false)}>{b.cancel}</button>
      <button
        type="button"
        className="b b-primary"
        disabled={ready.length === 0 || (scope === 'selected' && selected.length === 0)}
        onClick={() => {
          onApply(form, scope, overwrite);
          onOpenChange(false);
        }}
        data-testid="batch-set-apply"
      >
        {b.applySet}
      </button>
    </div>
  );

  return (
    <BulkDrawer open={open} onOpenChange={onOpenChange} title={b.setValuesTitle} description={b.setValuesIntro} footer={footer} testId="batch-set-panel">
      <div className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-[var(--fanous-color-text-primary)]">{b.scopeLabel}</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {(['all', 'selected'] as const).map((s) => (
              <label key={s} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                <input type="radio" name="batch-set-scope" checked={scope === s} onChange={() => setScope(s)} disabled={s === 'selected' && selected.length === 0}
                  className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`batch-set-scope-${s}`} />
                {(s === 'all' ? b.scopeAll : b.scopeSelected).replace('{count}', fmt(s === 'all' ? all.length : selected.length))}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-start gap-2 text-sm text-[var(--fanous-color-text-primary)]">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--fanous-color-primary)]"
            aria-describedby="batch-set-overwrite-hint" data-testid="batch-set-overwrite" />
          <span>
            {b.overwrite}
            <span id="batch-set-overwrite-hint" className="block text-xs text-[var(--fanous-color-text-secondary)]">{b.overwriteHint}</span>
          </span>
        </label>
        <BulkFieldsForm variant="set" form={form} onChange={setForm} subjects={subjects} fields={UPLOAD_SET_FIELDS.filter((f) => f !== 'playlists' || !!playlists)}
          playlists={playlists} knownTags={knownTags} orderKeys={UPLOAD_ORDER_KEYS} loadExistingTitles={loadExistingTitles} />
      </div>
    </BulkDrawer>
  );
}

export default BatchSetValuesPanel;
