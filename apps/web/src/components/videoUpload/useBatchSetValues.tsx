'use client';

/**
 * Upload page wiring of "Set values" (lib/upload/set-values.ts): row
 * checkboxes, each row's title fields, the panel, and the values new files
 * are created with. Kept out of the page so the page only plugs it in.
 *
 *   const seed = useSetValuesSeed();              // before useBatchUpload
 *   useBatchUpload({ ..., initiateValuesFor: seed.initiateValuesFor });
 *   const setValues = useBatchSetValues({ seed, files, ... });
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';
import type { RenameSubject, TitleLanguage, UploadQueueItem, VideoCategory } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { editableRow, useBatchRowValues } from '@/hooks/useBatchRowValues';
import type { BulkFormState } from '@/lib/bulk-edit/form';
import { defaultsForNewFiles, initiateFields, subjectOf, type QueueRowRef, type RowValues } from '@/lib/upload/set-values';
import { inputClass } from '@/components/bulkEdit/RenameFields';
import type { PlaylistSource } from '@/components/bulkEdit/BulkFieldsForm';
import { BatchSetValuesPanel, type SetScope } from './BatchSetValuesPanel';

export interface SetValuesSeed {
  seeded: WeakMap<File, RowValues>;
  defaultsRef: React.MutableRefObject<BulkFormState | null>;
  queuedRef: React.MutableRefObject<number>;
  channelRef: React.MutableRefObject<Partial<Record<TitleLanguage, string>> | undefined>;
  initiateValuesFor: (files: File[]) => Array<ReturnType<typeof initiateFields>>;
}

/** The values new files are created with: the ones last set for all files. */
export function useSetValuesSeed(): SetValuesSeed {
  const seededRef = useRef(new WeakMap<File, RowValues>());
  const defaultsRef = useRef<BulkFormState | null>(null);
  const queuedRef = useRef(0);
  const channelRef = useRef<Partial<Record<TitleLanguage, string>> | undefined>(undefined);
  const initiateValuesFor = useCallback((files: File[]) => {
    const values = defaultsForNewFiles(defaultsRef.current, files, queuedRef.current, channelRef.current);
    files.forEach((file, i) => seededRef.current.set(file, values[i]));
    return values.map((v, i) => initiateFields(v, files[i].name));
  }, []);
  return { seeded: seededRef.current, defaultsRef, queuedRef, channelRef, initiateValuesFor };
}

interface UseBatchSetValuesInput {
  seed: SetValuesSeed;
  files: UploadQueueItem[];
  channelId: string;
  channelName?: Partial<Record<TitleLanguage, string>>;
  playlists: PlaylistSource | null;
  batchPlaylists: {
    setBatchPlaylists: (ids: string[]) => void;
    overrides: Record<string, string[] | undefined>;
    setRowPlaylists: (rowId: string, ids: string[] | undefined) => void;
    committed: Record<string, string[]>;
  };
  setBatchCategory: (category: VideoCategory | undefined) => void;
  setRowCategories: (videoIds: string[], category: VideoCategory, overwrite: boolean) => number;
  disabled?: boolean;
}

export function useBatchSetValues({ seed, files, channelId, channelName, playlists, batchPlaylists, setBatchCategory, setRowCategories, disabled }: UseBatchSetValuesInput) {
  const { t, lang } = useLanguage();
  const b = t.bulkEdit;
  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en-US');
  const { rows, save, edit, setValues } = useBatchRowValues(files, channelId, seed.seeded);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  // Rows whose playlists "Set values" chose (not picked by hand)
  const setPlaylistRowsRef = useRef(new Set<string>());

  seed.queuedRef.current = files.length;
  seed.channelRef.current = channelName;

  const editable = useMemo(() => files.filter(editableRow), [files]);
  const refs = useMemo<QueueRowRef[]>(() => editable.map((f) => ({ id: f.id, fileName: f.file.name, addedAt: f.startedAt ? new Date(f.startedAt).toISOString() : undefined })), [editable]);
  const subjects = useMemo<RenameSubject[]>(() => refs.filter((r) => rows[r.id]).map((r) => subjectOf(r, rows[r.id], channelName)), [refs, rows, channelName]);
  const chosen = subjects.filter((s) => selected.has(s.id));

  const apply = (form: BulkFormState, scope: SetScope, overwrite: boolean) => {
    const targets = scope === 'all' ? refs : refs.filter((r) => selected.has(r.id));
    const result = setValues(targets, form, { overwrite, channel: channelName });
    let kept = result.skipped;
    const targetFiles = editable.filter((f) => targets.some((r) => r.id === f.id));
    if (form.ticked.includes('category') && form.category) {
      const category = form.category as VideoCategory;
      if (scope === 'all') setBatchCategory(category);
      kept += setRowCategories(targetFiles.map((f) => f.videoId as string), category, overwrite);
    }
    if (form.ticked.includes('playlists') && form.playlistsAdd.length) {
      if (scope === 'all') batchPlaylists.setBatchPlaylists(form.playlistsAdd);
      for (const f of targetFiles) {
        if (batchPlaylists.committed[f.id]) continue;
        const own = batchPlaylists.overrides[f.id] !== undefined && !setPlaylistRowsRef.current.has(f.id);
        if (own && !overwrite) {
          kept++;
          continue;
        }
        if (scope === 'all') {
          batchPlaylists.setRowPlaylists(f.id, undefined);
          setPlaylistRowsRef.current.delete(f.id);
        } else {
          batchPlaylists.setRowPlaylists(f.id, form.playlistsAdd);
          setPlaylistRowsRef.current.add(f.id);
        }
      }
    }
    // Files picked from now on are created with these values
    if (scope === 'all') seed.defaultsRef.current = form;
    setNotice([b.setDone.replace('{count}', fmt(scope === 'all' ? targets.length : targets.length)), kept ? b.setSkipped.replace('{count}', fmt(kept)) : ''].filter(Boolean).join(' '));
  };

  const toggle = (rowId: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(rowId);
    else next.delete(rowId);
    return next;
  });

  const renderSelect = (file: UploadQueueItem) => {
    if (!editableRow(file)) return null;
    return (
      <input
        type="checkbox"
        checked={selected.has(file.id)}
        onChange={(e) => toggle(file.id, e.target.checked)}
        aria-label={b.selectFile.replace('{name}', rows[file.id]?.values.titleEn || file.file.name)}
        className="h-5 w-5 accent-[var(--fanous-color-primary)]"
        data-testid="batch-file-select"
      />
    );
  };

  const renderTitles = (file: UploadQueueItem) => {
    const row = rows[file.id];
    if (!row || !editableRow(file)) return null;
    const state = save[file.id];
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {(['en', 'ar'] as TitleLanguage[]).map((l) => {
          const field = l === 'en' ? 'titleEn' : 'titleAr';
          const id = `batch-title-${l}-${file.id}`;
          return (
            <div key={l}>
              <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-[var(--fanous-color-text-secondary)]">
                {l === 'en' ? b.rowTitleEn : b.rowTitleAr}
                {row.touched.includes(field) && <span className="rounded-full border border-[var(--fanous-color-outline)] px-1.5 text-[var(--fanous-color-text-primary)]" data-testid="batch-file-title-edited">{b.rowEdited}</span>}
              </label>
              <input
                id={id}
                dir={l === 'ar' ? 'rtl' : 'ltr'}
                lang={l}
                maxLength={100}
                value={row.values[field]}
                onChange={(e) => edit(file.id, field, { [field]: e.target.value })}
                className={inputClass}
                data-testid={`batch-file-title-${l}`}
              />
            </div>
          );
        })}
        {state && (
          <p role="status" className={`text-xs sm:col-span-2 ${state === 'failed' ? 'text-[var(--fanous-color-error-text)]' : 'text-[var(--fanous-color-text-secondary)]'}`}
            data-testid="batch-file-values-save" data-state={state}>
            {state === 'saving' ? b.rowSaving : state === 'saved' ? b.rowSaved : b.rowSaveFailed}
          </p>
        )}
      </div>
    );
  };

  const titleOf = (file: UploadQueueItem) => {
    const v = rows[file.id]?.values;
    return v ? (lang === 'ar' ? v.titleAr || v.titleEn : v.titleEn || v.titleAr) || undefined : undefined;
  };

  const allSelected = editable.length > 0 && editable.every((f) => selected.has(f.id));
  const toolbar = (
    <div className="mb-3 flex flex-wrap items-center gap-3" data-testid="batch-set-toolbar">
      {editable.length > 0 && (
        <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
          <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(editable.map((f) => f.id)) : new Set())}
            className="h-5 w-5 accent-[var(--fanous-color-primary)]" data-testid="batch-select-all" />
          {b.selectAllFiles}
        </label>
      )}
      {selected.size > 0 && <span className="text-sm text-[var(--fanous-color-text-secondary)]" data-testid="batch-selected-count">{b.selectedCount.replace('{count}', fmt(selected.size))}</span>}
      <button type="button" className="b b-secondary b-sm ms-auto" onClick={() => setOpen(true)} disabled={disabled} data-testid="batch-set-values">
        <ListChecks aria-hidden="true" />
        {b.setValues}
      </button>
      <p className="w-full text-sm text-[var(--fanous-color-text-secondary)]" role="status" aria-live="polite" data-testid="batch-set-notice">{notice}</p>
    </div>
  );

  const panel = (
    <BatchSetValuesPanel open={open} onOpenChange={setOpen} all={subjects} selected={chosen} initial={seed.defaultsRef.current}
      playlists={playlists} onApply={apply} />
  );

  return { renderSelect, renderTitles, titleOf, toolbar, panel, openPanel: () => setOpen(true) };
}
