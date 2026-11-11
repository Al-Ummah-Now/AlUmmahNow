/**
 * The fields of a bulk panel, one tickable block each. Only ticked fields
 * are applied; an unticked field says it stays as it is (Studio) or is left
 * to each file (upload queue).
 *
 * `variant` sets the words: 'edit' changes existing videos ("Change
 * category"), 'set' gives queued files their first values ("Set category").
 */
'use client';

import React, { useMemo } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { TagAutocomplete } from '@/components/ui/TagAutocomplete';
import { PlaylistPicker } from '@/components/videoUpload/PlaylistPicker';
import type { PlaylistWithVideos } from '@/lib/api/playlists';
import type { NewPlaylistInput } from '@/lib/api/upload-playlists-client';
import type { RenameSubject, TitleLanguage } from '@al-ummah/shared-types';
import {
  CONTENT_LANGUAGES,
  fieldProblem,
  renamePreview,
  type BulkField,
  type BulkFormState,
  type DescriptionState,
} from '@/lib/bulk-edit/form';
import { RenameFields, hintClass, inputClass, labelClass } from './RenameFields';
import { RenamePreview } from './RenamePreview';
import { CategoryAutocomplete } from './CategoryAutocomplete';

export interface PlaylistSource {
  list: PlaylistWithVideos[];
  loading?: boolean;
  failed?: boolean;
  create: (input: NewPlaylistInput) => Promise<PlaylistWithVideos | null>;
}

interface BulkFieldsFormProps {
  variant: 'edit' | 'set';
  form: BulkFormState;
  onChange: (next: BulkFormState) => void;
  subjects: RenameSubject[];
  /** Fields offered, in order */
  fields: BulkField[];
  playlists?: PlaylistSource | null;
  knownTags?: string[];
  selectedTags?: string[];
  hideTokens?: string[];
}

export function BulkFieldsForm({ variant, form, onChange, subjects, fields, playlists, knownTags = [], selectedTags = [], hideTokens }: BulkFieldsFormProps) {
  const { t } = useLanguage();
  const b = t.bulkEdit;
  const f = b.fields;
  const set = <K extends keyof BulkFormState>(key: K, v: BulkFormState[K]) => onChange({ ...form, [key]: v });
  const ticked = (field: BulkField) => form.ticked.includes(field);
  const tick = (field: BulkField, on: boolean) =>
    set('ticked', on ? Array.from(new Set([...form.ticked, field])) : form.ticked.filter((x) => x !== field));

  const titleTicked = form.ticked.includes('title');
  const preview = useMemo(() => (titleTicked ? renamePreview(form, subjects) : []), [titleTicked, form, subjects]);

  const names: Record<BulkField, string> = {
    title: f.title,
    description: f.description,
    category: f.category,
    language: f.language,
    visibility: f.visibility,
    playlists: f.playlists,
    tags: f.tags,
    schedule: f.schedule,
    comments: f.comments,
  };
  const tickLabel = (field: BulkField) => (variant === 'edit' ? b.changeField : b.setField).replace('{field}', names[field]);

  const setDescription = (lang: TitleLanguage, next: Partial<DescriptionState>) =>
    set('description', { ...form.description, [lang]: { ...form.description[lang], ...next } });

  const body = (field: BulkField): React.ReactNode => {
    switch (field) {
      case 'title':
        return (
          <div className="space-y-4">
            <RenameFields value={form.rename} onChange={(rename) => set('rename', rename)} hideTokens={hideTokens} idPrefix={`bulk-${variant}-rename`} />
            <RenamePreview
              rows={preview}
              testId={`bulk-${variant}-preview`}
              onToggle={(id, include) => set('rename', {
                ...form.rename,
                excluded: include ? form.rename.excluded.filter((x) => x !== id) : Array.from(new Set([...form.rename.excluded, id])),
              })}
            />
          </div>
        );
      case 'description':
        return (
          <div className="space-y-4">
            {(['en', 'ar'] as TitleLanguage[]).map((lang) => {
              const d = form.description[lang];
              const id = `bulk-${variant}-desc-${lang}`;
              return (
                <fieldset key={lang} className="space-y-2">
                  <legend className="sr-only">{lang === 'en' ? f.descriptionEn : f.descriptionAr}</legend>
                  <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--fanous-color-text-primary)]">
                    <input type="checkbox" checked={d.enabled} onChange={(e) => setDescription(lang, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`${id}-enabled`} />
                    {lang === 'en' ? f.descriptionEn : f.descriptionAr}
                  </label>
                  {d.enabled && (
                    <>
                      {variant === 'edit' && (
                        <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={f.descriptionMode}>
                          {(['append', 'prepend', 'replace'] as const).map((mode) => (
                            <label key={mode} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                              <input type="radio" name={`${id}-mode`} checked={d.mode === mode} onChange={() => setDescription(lang, { mode })}
                                className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`${id}-${mode}`} />
                              {f[mode]}
                            </label>
                          ))}
                        </div>
                      )}
                      <textarea
                        id={id}
                        aria-label={lang === 'en' ? f.descriptionEn : f.descriptionAr}
                        dir={lang === 'ar' ? 'rtl' : 'ltr'}
                        lang={lang}
                        rows={3}
                        maxLength={5000}
                        value={d.text}
                        onChange={(e) => setDescription(lang, { text: e.target.value })}
                        className={`${inputClass} py-2`}
                        data-testid={`${id}-text`}
                      />
                    </>
                  )}
                </fieldset>
              );
            })}
          </div>
        );
      case 'category':
        return (
          <CategoryAutocomplete value={form.category} onChange={(c) => set('category', c)} label={f.category}
            inputId={`bulk-${variant}-category`} placeholder={f.categoryPlaceholder} testId={`bulk-${variant}-category`} />
        );
      case 'language':
        return (
          <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={f.language}>
            {CONTENT_LANGUAGES.map((l) => (
              <label key={l} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                <input type="radio" name={`bulk-${variant}-language`} checked={form.language === l} onChange={() => set('language', l)}
                  className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`bulk-${variant}-language-${l}`} />
                {f.languageNames[l]}
              </label>
            ))}
          </div>
        );
      case 'visibility':
        return (
          <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={f.visibility}>
            {(['public', 'private'] as const).map((v) => (
              <label key={v} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                <input type="radio" name={`bulk-${variant}-visibility`} checked={form.visibility === v} onChange={() => set('visibility', v)}
                  className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`bulk-${variant}-visibility-${v}`} />
                {f[v]}
              </label>
            ))}
          </div>
        );
      case 'comments':
        return (
          <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={f.comments}>
            {([['on', f.commentsOn], ['held', f.commentsHeld], ['off', f.commentsOff]] as const).map(([v, label]) => (
              <label key={v} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                <input type="radio" name={`bulk-${variant}-comments`} checked={form.comments === v} onChange={() => set('comments', v)}
                  className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`bulk-${variant}-comments-${v}`} />
                {label}
              </label>
            ))}
          </div>
        );
      case 'playlists':
        if (!playlists) return null;
        return (
          <div className="space-y-4">
            <PlaylistPicker id={`bulk-${variant}-playlists-add`} testId={`bulk-${variant}-playlists-add`} label={f.addToPlaylists}
              playlists={playlists.list} loading={playlists.loading} failed={playlists.failed}
              selected={form.playlistsAdd} onChange={(ids) => set('playlistsAdd', ids)} onCreate={playlists.create} compact />
            {variant === 'edit' && (
              <PlaylistPicker id={`bulk-${variant}-playlists-remove`} testId={`bulk-${variant}-playlists-remove`} label={f.removeFromPlaylists}
                playlists={playlists.list} loading={playlists.loading} failed={playlists.failed}
                selected={form.playlistsRemove} onChange={(ids) => set('playlistsRemove', ids)} onCreate={playlists.create} compact />
            )}
          </div>
        );
      case 'tags':
        return (
          <div className="space-y-2">
            {variant === 'edit' && (
              <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={f.tagsMode}>
                {([['add', f.tagsAdd], ['remove', f.tagsRemove], ['replace', f.tagsReplace]] as const).map(([v, label]) => (
                  <label key={v} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                    <input type="radio" name={`bulk-${variant}-tags-mode`} checked={form.tagsMode === v} onChange={() => set('tagsMode', v)}
                      className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`bulk-${variant}-tags-${v}`} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            <label htmlFor={`bulk-${variant}-tags`} className={labelClass}>{f.tags}</label>
            <TagAutocomplete mode="list" inputId={`bulk-${variant}-tags`} value={form.tags} onValueChange={(v) => set('tags', v)}
              tags={form.tagsMode === 'remove' ? selectedTags : knownTags} label={f.tags} placeholder=""
              describedBy={`bulk-${variant}-tags-hint`} testId={`bulk-${variant}-tags`} inputClassName={inputClass} />
            <p id={`bulk-${variant}-tags-hint`} className={hintClass}>{b.tagsHint}</p>
          </div>
        );
      case 'schedule':
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label htmlFor={`bulk-${variant}-schedule-start`} className={labelClass}>{f.scheduleStart}</label>
              <input id={`bulk-${variant}-schedule-start`} type="datetime-local" className={inputClass} value={form.scheduleStart}
                onChange={(e) => set('scheduleStart', e.target.value)} data-testid={`bulk-${variant}-schedule-start`} />
            </div>
            <div>
              <label htmlFor={`bulk-${variant}-schedule-every`} className={labelClass}>{f.scheduleEvery}</label>
              <input id={`bulk-${variant}-schedule-every`} type="number" min={0} max={365} className={inputClass} value={form.scheduleEvery}
                onChange={(e) => set('scheduleEvery', Math.max(0, Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0))}
                aria-describedby={`bulk-${variant}-schedule-hint`} data-testid={`bulk-${variant}-schedule-every`} />
            </div>
            <div className="flex items-end gap-4 sm:col-span-2" role="radiogroup" aria-label={f.scheduleEvery}>
              {(['hours', 'days'] as const).map((u) => (
                <label key={u} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                  <input type="radio" name={`bulk-${variant}-schedule-unit`} checked={form.scheduleUnit === u} onChange={() => set('scheduleUnit', u)}
                    className="h-4 w-4 accent-[var(--fanous-color-primary)]" data-testid={`bulk-${variant}-schedule-${u}`} />
                  {f[u]}
                </label>
              ))}
            </div>
            <p id={`bulk-${variant}-schedule-hint`} className={`${hintClass} sm:col-span-3`}>{f.scheduleEveryHint}</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3" data-testid={`bulk-${variant}-fields`}>
      {fields.map((field) => {
        const on = ticked(field);
        const problem = on ? fieldProblem(form, field, field === 'title' ? preview : undefined) : '';
        return (
          <section
            key={field}
            className={`rounded-lg border p-3 ${on ? 'border-[var(--fanous-color-primary)] bg-[var(--fanous-color-surface)]' : 'border-[var(--fanous-color-divider)]'}`}
            data-testid={`bulk-${variant}-field-${field}`}
            data-ticked={on ? 'true' : 'false'}
            aria-labelledby={`bulk-${variant}-tick-${field}-label`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--fanous-color-text-primary)]" id={`bulk-${variant}-tick-${field}-label`}>
                <input type="checkbox" checked={on} onChange={(e) => tick(field, e.target.checked)}
                  className="h-5 w-5 accent-[var(--fanous-color-primary)]" data-testid={`bulk-${variant}-tick-${field}`} />
                {tickLabel(field)}
              </label>
              <span className={`text-xs ${on ? 'font-semibold text-[var(--fanous-color-text-primary)]' : 'text-[var(--fanous-color-text-secondary)]'}`} data-testid={`bulk-${variant}-state-${field}`}>
                {variant === 'edit' ? (on ? b.willChange : b.untouched) : (on ? b.willSet : b.leftToFiles)}
              </span>
            </div>
            {on && <div className="mt-3">{body(field)}</div>}
            {on && problem && problem !== 'no_titles' && (
              <p className="mt-2 text-xs text-[var(--fanous-color-error-text)]" data-testid={`bulk-${variant}-problem-${field}`}>{b.fieldIncomplete}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export default BulkFieldsForm;
