'use client';

/**
 * The playlist's own fields: name, description, visibility and order (manual,
 * or automatic by a field in either direction). Shared by the create form,
 * the inline create in "Add to playlist" and the playlist editor.
 */

import React from 'react';
import { Lock, Globe, Hand, ArrowDownUp } from 'lucide-react';
import {
  PLAYLIST_SORT_FIELDS,
  type PlaylistSortDirection,
  type PlaylistSortField,
  type PlaylistSortMode,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { FIELD, LABEL, MUTED, TEXT } from './styles';
import '@/theme/playlist-tools.css';

export interface PlaylistDetailsValue {
  title: string;
  description: string;
  isPublic: boolean;
  sortMode: PlaylistSortMode;
  sortField: PlaylistSortField;
  sortDirection: PlaylistSortDirection;
}

export const EMPTY_PLAYLIST_DETAILS: PlaylistDetailsValue = {
  title: '',
  description: '',
  isPublic: true,
  sortMode: 'manual',
  sortField: 'added',
  sortDirection: 'desc',
};

export const PLAYLIST_TITLE_MAX = 150;
export const PLAYLIST_DESCRIPTION_MAX = 5000;

interface Props {
  value: PlaylistDetailsValue;
  onChange: (next: PlaylistDetailsValue) => void;
  /** Prefix for element ids (several forms can be on one page). */
  idPrefix: string;
  /** Inline create: name, visibility and order only. */
  compact?: boolean;
  /** The editor shows the order next to the videos instead. */
  hideSort?: boolean;
  disabled?: boolean;
}

/** Choice card: a visually hidden radio drives the card (keyboard and screen readers use the radio). */
function ChoiceCard({ name, checked, onSelect, icon, title, help, disabled, testId }: {
  name: string; checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; help: string; disabled?: boolean; testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      data-checked={checked || undefined}
      className={`pl-choice relative flex cursor-pointer items-start gap-3 rounded-[var(--r-md)] p-3 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} className="peer pl-hit" />
      <span className="rd mt-0.5 flex-none" data-on={checked || undefined} aria-hidden="true" />
      <span className="min-w-0">
        <span className={`flex items-center gap-1.5 text-sm font-semibold ${TEXT}`}>
          {icon}
          {title}
        </span>
        <span className={`mt-0.5 block text-xs ${MUTED}`}>{help}</span>
      </span>
    </label>
  );
}

/** The direction labels read naturally for each field ("Newest first", "A to Z"…). */
export function directionLabels(field: PlaylistSortField, t: ReturnType<typeof useLanguage>['t']): Record<PlaylistSortDirection, string> {
  const p = t.playlistTools;
  switch (field) {
    case 'added':
    case 'published':
      return { asc: p.dirOldest, desc: p.dirNewest };
    case 'title':
      return { asc: p.dirAZ, desc: p.dirZA };
    case 'views':
      return { asc: p.dirFewest, desc: p.dirMost };
    case 'duration':
      return { asc: p.dirShortest, desc: p.dirLongest };
  }
}

export function fieldLabel(field: PlaylistSortField, t: ReturnType<typeof useLanguage>['t']): string {
  const p = t.playlistTools;
  return { added: p.sortAdded, published: p.sortPublished, title: p.sortTitle, views: p.sortViews, duration: p.sortDuration }[field];
}

/** The order controls on their own (the editor shows them next to the video list). */
export function PlaylistSortFields({ value, onChange, idPrefix, disabled }: Omit<Props, 'compact' | 'hideSort'>) {
  const { t } = useLanguage();
  const p = t.playlistTools;
  const set = (patch: Partial<PlaylistDetailsValue>) => onChange({ ...value, ...patch });
  const dirs = directionLabels(value.sortField, t);
  return (
    <fieldset className="space-y-3" data-testid="playlist-sort">
      <legend className={LABEL}>{p.sortLabel}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <ChoiceCard
          name={`${idPrefix}-sort-mode`}
          checked={value.sortMode === 'manual'}
          onSelect={() => set({ sortMode: 'manual' })}
          icon={<Hand className="h-4 w-4" aria-hidden="true" />}
          title={p.sortManual}
          help={p.sortManualHelp}
          disabled={disabled}
          testId="sort-mode-manual"
        />
        <ChoiceCard
          name={`${idPrefix}-sort-mode`}
          checked={value.sortMode === 'auto'}
          onSelect={() => set({ sortMode: 'auto' })}
          icon={<ArrowDownUp className="h-4 w-4" aria-hidden="true" />}
          title={p.sortAuto}
          help={p.sortAutoHelp}
          disabled={disabled}
          testId="sort-mode-auto"
        />
      </div>
      {value.sortMode === 'auto' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-sort-field`} className={LABEL}>{p.sortFieldLabel}</label>
            <select
              id={`${idPrefix}-sort-field`}
              value={value.sortField}
              disabled={disabled}
              onChange={(e) => set({ sortField: e.target.value as PlaylistSortField })}
              className={FIELD}
              data-testid="sort-field"
            >
              {PLAYLIST_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>{fieldLabel(field, t)}</option>
              ))}
            </select>
          </div>
          <div role="group" aria-labelledby={`${idPrefix}-sort-direction-label`}>
            <span id={`${idPrefix}-sort-direction-label`} className={LABEL}>{p.sortDirectionLabel}</span>
            <div className="flex flex-wrap gap-2">
              {(['asc', 'desc'] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  aria-pressed={value.sortDirection === direction}
                  disabled={disabled}
                  onClick={() => set({ sortDirection: direction })}
                  className="chip"
                  data-testid={`sort-direction-${direction}`}
                >
                  {dirs[direction]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}

export default function PlaylistDetailsFields({ value, onChange, idPrefix, compact, hideSort, disabled }: Props) {
  const { t } = useLanguage();
  const set = (patch: Partial<PlaylistDetailsValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-title`} className={LABEL}>{t.playlist.nameLabel}</label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={value.title}
          maxLength={PLAYLIST_TITLE_MAX}
          required
          disabled={disabled}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t.playlist.namePlaceholder}
          className={FIELD}
        />
      </div>

      {!compact && (
        <div>
          <label htmlFor={`${idPrefix}-description`} className={LABEL}>{t.playlist.descriptionLabel}</label>
          <textarea
            id={`${idPrefix}-description`}
            value={value.description}
            rows={3}
            maxLength={PLAYLIST_DESCRIPTION_MAX}
            disabled={disabled}
            onChange={(e) => set({ description: e.target.value })}
            placeholder={t.playlist.descriptionPlaceholder}
            className={`${FIELD} resize-y`}
          />
        </div>
      )}

      <fieldset>
        <legend className={LABEL}>{t.playlist.visibilityLabel}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            name={`${idPrefix}-visibility`}
            checked={value.isPublic}
            onSelect={() => set({ isPublic: true })}
            icon={<Globe className="h-4 w-4" aria-hidden="true" />}
            title={t.playlist.publicLabel}
            help={t.playlist.publicDescription}
            disabled={disabled}
          />
          <ChoiceCard
            name={`${idPrefix}-visibility`}
            checked={!value.isPublic}
            onSelect={() => set({ isPublic: false })}
            icon={<Lock className="h-4 w-4" aria-hidden="true" />}
            title={t.playlist.privateLabel}
            help={t.playlist.privateDescription}
            disabled={disabled}
          />
        </div>
      </fieldset>

      {!hideSort && <PlaylistSortFields value={value} onChange={onChange} idPrefix={idPrefix} disabled={disabled} />}
    </div>
  );
}
