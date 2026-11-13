'use client';

/**
 * The playlist's own fields: name and description in English and Arabic,
 * visibility and order (manual,
 * or automatic by a field in either direction). Shared by the create form,
 * the inline create in "Add to playlist" and the playlist editor.
 */

import React from 'react';
import { Lock, Globe, Hand, ArrowDownUp, Link2 } from 'lucide-react';
import {
  PLAYLIST_SORT_FIELDS,
  type PlaylistSortDirection,
  type PlaylistSortField,
  type PlaylistSortMode,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { OptionCard } from '@/components/ui/OptionCard';
import { BilingualPair } from '@/components/bulkEdit/BilingualPair';
import { FIELD, LABEL, MUTED } from './styles';
import '@/theme/playlist-tools.css';

export interface PlaylistDetailsValue {
  /** Name and description in each language (an empty one shows the other to its readers) */
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  isPublic: boolean;
  /** With isPublic false: link-only (anyone with the link, never listed) instead of private */
  isUnlisted?: boolean;
  sortMode: PlaylistSortMode;
  sortField: PlaylistSortField;
  sortDirection: PlaylistSortDirection;
}

export const EMPTY_PLAYLIST_DETAILS: PlaylistDetailsValue = {
  titleEn: '',
  titleAr: '',
  descriptionEn: '',
  descriptionAr: '',
  isPublic: true,
  sortMode: 'manual',
  sortField: 'added',
  sortDirection: 'desc',
};

/** The API visibility of the chosen details: public, unlisted (link-only) or private. */
export function detailsVisibility(value: Pick<PlaylistDetailsValue, 'isPublic' | 'isUnlisted'>): 'public' | 'unlisted' | 'private' {
  if (value.isPublic) return 'public';
  return value.isUnlisted ? 'unlisted' : 'private';
}

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

/** A choice card in the app's shared option-card style. */
function ChoiceCard({ name, checked, onSelect, icon, title, help, disabled, testId }: {
  name: string; checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; help: string; disabled?: boolean; testId?: string;
}) {
  return <OptionCard name={name} checked={checked} onSelect={onSelect} icon={icon} title={title} help={help} disabled={disabled} testId={testId} />;
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
  const p = t.playlistTools;
  const set = (patch: Partial<PlaylistDetailsValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      {/* English and Arabic side by side, like video titles; Translate shows once a translator is registered */}
      <BilingualPair
        legend={p.namesLegend}
        labels={{ en: p.nameEnglish, ar: p.nameArabic }}
        textOf={(language) => (language === 'en' ? value.titleEn : value.titleAr)}
        onTranslated={(language, text) => set(language === 'en' ? { titleEn: text } : { titleAr: text })}
        idPrefix={`${idPrefix}-title`}
        testId={`${idPrefix}-title-pair`}
      >
        {(language, { heading }) => (
          <input
            id={`${idPrefix}-title-${language}`}
            type="text"
            value={language === 'en' ? value.titleEn : value.titleAr}
            maxLength={PLAYLIST_TITLE_MAX}
            disabled={disabled}
            onChange={(e) => set(language === 'en' ? { titleEn: e.target.value } : { titleAr: e.target.value })}
            placeholder={language === 'en' ? p.namePlaceholderEnglish : p.namePlaceholderArabic}
            aria-labelledby={heading}
            aria-describedby={`${idPrefix}-title-help`}
            dir={language === 'ar' ? 'rtl' : 'ltr'}
            lang={language}
            className={FIELD}
            data-testid={`${idPrefix}-title-${language}`}
          />
        )}
      </BilingualPair>
      <p id={`${idPrefix}-title-help`} className={`-mt-2 text-xs ${MUTED}`}>{p.nameOneLanguage}</p>

      {!compact && (
        <BilingualPair
          legend={p.descriptionsLegend}
          labels={{ en: p.descriptionEnglish, ar: p.descriptionArabic }}
          textOf={(language) => (language === 'en' ? value.descriptionEn : value.descriptionAr)}
          onTranslated={(language, text) => set(language === 'en' ? { descriptionEn: text } : { descriptionAr: text })}
          idPrefix={`${idPrefix}-description`}
          testId={`${idPrefix}-description-pair`}
        >
          {(language, { heading }) => (
            <textarea
              id={`${idPrefix}-description-${language}`}
              value={language === 'en' ? value.descriptionEn : value.descriptionAr}
              rows={3}
              maxLength={PLAYLIST_DESCRIPTION_MAX}
              disabled={disabled}
              onChange={(e) => set(language === 'en' ? { descriptionEn: e.target.value } : { descriptionAr: e.target.value })}
              placeholder={t.playlist.descriptionPlaceholder}
              aria-labelledby={heading}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
              lang={language}
              className={`${FIELD} resize-y`}
              data-testid={`${idPrefix}-description-${language}`}
            />
          )}
        </BilingualPair>
      )}

      <fieldset>
        <legend className={LABEL}>{t.playlist.visibilityLabel}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <ChoiceCard
            name={`${idPrefix}-visibility`}
            checked={value.isPublic}
            onSelect={() => set({ isPublic: true, isUnlisted: false })}
            icon={<Globe className="h-4 w-4" aria-hidden="true" />}
            title={t.playlist.publicLabel}
            help={t.playlist.publicDescription}
            disabled={disabled}
          />
          <ChoiceCard
            name={`${idPrefix}-visibility`}
            checked={!value.isPublic && value.isUnlisted === true}
            onSelect={() => set({ isPublic: false, isUnlisted: true })}
            icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
            title={t.playlist.unlistedLabel}
            help={t.playlist.unlistedDescription}
            disabled={disabled}
          />
          <ChoiceCard
            name={`${idPrefix}-visibility`}
            checked={!value.isPublic && value.isUnlisted !== true}
            onSelect={() => set({ isPublic: false, isUnlisted: false })}
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
