'use client';

/**
 * Playlists for a new upload (single upload form, batch settings, each batch
 * row): pick any of the channel's playlists (multi-select with search) or
 * create one inline (name, visibility, optional description); a new playlist
 * is selected at once. Colours come from Fanous tokens only (light, dark, RTL).
 */
import { Highlight } from '@/components/ui/Autocomplete';
import React, { useId, useMemo, useState } from 'react';
import { ChevronDown, ListVideo, Lock, Plus, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { playlistName } from '@/lib/playlists/playlist-names';
import { normalizePlaylistTitle } from '@/lib/playlists/playlist-utils';
import { filterPlaylists, togglePlaylist } from '@/lib/upload/playlist-adds';
import type { PlaylistWithVideos } from '@/lib/api/playlists';
import type { NewPlaylistInput } from '@/lib/api/upload-playlists-client';

const DESCRIPTION_MAX = 5000;
const TITLE_MAX = 150;

export interface PlaylistPickerProps {
  /** Base id for the controls (unique on the page) */
  id?: string;
  label: string;
  hint?: string;
  playlists: PlaylistWithVideos[];
  loading?: boolean;
  /** The list could not be loaded */
  failed?: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Creates a playlist; resolves to it, or null when it was not created */
  onCreate: (input: NewPlaylistInput) => Promise<PlaylistWithVideos | null>;
  disabled?: boolean;
  /** The adds were requested: shown, no longer changed, with a line saying so */
  locked?: boolean;
  /** Shown only (a batch row that follows the batch's choice) */
  readOnly?: boolean;
  /** Smaller label (batch rows) */
  compact?: boolean;
  testId?: string;
}

const field = 'w-full rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-3 py-2 text-sm text-[var(--fanous-color-text-primary)] placeholder:text-[var(--fanous-color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] disabled:opacity-50';
const quietButton = 'inline-flex items-center gap-1.5 rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-3 py-1.5 text-sm text-[var(--fanous-color-text-primary)] hover:bg-[var(--fanous-color-surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed';
const primaryButton = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--fanous-color-primary)] px-3 py-1.5 text-sm font-medium text-[var(--fanous-color-on-primary)] hover:bg-[var(--fanous-color-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] disabled:opacity-50 disabled:cursor-not-allowed';

export function PlaylistPicker({
  id,
  label,
  hint,
  playlists,
  loading = false,
  failed = false,
  selected,
  onChange,
  onCreate,
  disabled = false,
  locked = false,
  readOnly = false,
  compact = false,
  testId = 'playlist-picker',
}: PlaylistPickerProps) {
  const { t, lang, isRTL } = useLanguage();
  const s = t.playlist.upload;
  const autoId = useId();
  const base = id ?? `playlist-picker-${autoId.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const nameOf = (p: Pick<PlaylistWithVideos, 'name' | 'title'>) => playlistName(p, lang === 'ar' ? 'ar' : 'en');
  const byId = useMemo(() => new Map(playlists.map((p) => [p.id, p])), [playlists]);
  const chosen = selected.map((pid) => byId.get(pid)).filter((p): p is PlaylistWithVideos => !!p);
  const matches = filterPlaylists(playlists, query);
  const inactive = disabled || locked || readOnly;

  const resetForm = () => {
    setCreating(false);
    setTitle('');
    setDescription('');
    setIsPublic(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = normalizePlaylistTitle(title, TITLE_MAX);
    if (!name) {
      setMessage({ kind: 'error', text: t.playlist.nameRequired });
      return;
    }
    setBusy(true);
    setMessage(null);
    const playlist = await onCreate({ title: name, description: description.trim() || undefined, isPublic });
    setBusy(false);
    if (!playlist) {
      setMessage({ kind: 'error', text: t.playlist.createFailed });
      return;
    }
    onChange(selected.includes(playlist.id) ? selected : [...selected, playlist.id]);
    setMessage({ kind: 'ok', text: s.created.replace('{title}', nameOf(playlist) || name) });
    resetForm();
  };

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'} data-testid={testId} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={`flex items-center gap-2 font-medium text-[var(--fanous-color-text-primary)] ${compact ? 'text-xs' : 'text-sm'}`} id={`${base}-label`}>
        <ListVideo className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
        {label}
      </div>
      {hint && !compact && <p className="text-xs text-[var(--fanous-color-text-secondary)]">{hint}</p>}

      <ul className="flex flex-wrap gap-1.5" aria-labelledby={`${base}-label`} data-testid={`${testId}-chips`}>
        {chosen.length === 0 && (
          <li className="text-xs text-[var(--fanous-color-text-muted)]">{s.noneSelected}</li>
        )}
        {chosen.map((p) => (
          <li
            key={p.id}
            data-testid={`${testId}-chip`}
            data-playlist-id={p.id}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface-raised)] px-2.5 py-0.5 text-xs text-[var(--fanous-color-text-primary)]"
          >
            {p.isPublic === false && <Lock className="h-3 w-3 shrink-0 text-[var(--fanous-color-text-muted)]" aria-label={t.playlist.privateLabel} />}
            <span className="truncate">{nameOf(p)}</span>
            {!inactive && (
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== p.id))}
                className="rounded-full p-0.5 text-[var(--fanous-color-text-secondary)] hover:text-[var(--fanous-color-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
                aria-label={s.remove.replace('{title}', nameOf(p))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {locked ? (
        <p className="text-xs text-[var(--fanous-color-text-secondary)]" data-testid={`${testId}-locked`}>{s.locked}</p>
      ) : readOnly ? null : (
        <button
          type="button"
          className={quietButton}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${base}-panel`}
          disabled={disabled}
          data-testid={`${testId}-toggle`}
        >
          {s.choose}
          {selected.length > 0 && <span className="text-[var(--fanous-color-text-secondary)]">· {s.selectedCount.replace('{count}', String(selected.length))}</span>}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      )}

      {open && !inactive && (
        <div
          id={`${base}-panel`}
          className="space-y-3 rounded-lg border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)] p-3"
          data-testid={`${testId}-panel`}
        >
          <div>
            <label htmlFor={`${base}-search`} className="sr-only">{s.searchLabel}</label>
            <input
              id={`${base}-search`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={s.searchPlaceholder}
              className={field}
              data-testid={`${testId}-search`}
            />
          </div>

          {/* A filtered checklist (several can be ticked), so not a combobox: the count is announced instead */}
          <p className="sr-only" role="status" aria-live="polite" data-testid={`${testId}-count`}>
            {query.trim() && !loading && !failed ? (matches.length === 1 ? t.search.foundOneResult : t.search.foundResults.replace('{count}', String(matches.length))) : ''}
          </p>
          <fieldset className="max-h-56 overflow-y-auto" aria-labelledby={`${base}-label`}>
            {loading ? (
              <p className="py-1 text-sm text-[var(--fanous-color-text-muted)]" role="status">{t.common.loading}</p>
            ) : failed ? (
              <p className="py-1 text-sm text-[var(--fanous-color-error-text)]" role="alert">{t.playlist.loadFailed}</p>
            ) : playlists.length === 0 ? (
              <p className="py-1 text-sm text-[var(--fanous-color-text-muted)]">{t.playlist.noPlaylists}</p>
            ) : matches.length === 0 ? (
              <p className="py-1 text-sm text-[var(--fanous-color-text-muted)]">{s.noMatches}</p>
            ) : (
              matches.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--fanous-color-surface-raised)]"
                  data-testid={`${testId}-option`}
                  data-playlist-id={p.id}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--fanous-color-primary)]"
                    checked={selected.includes(p.id)}
                    onChange={() => onChange(togglePlaylist(selected, p.id))}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--fanous-color-text-primary)]" dir="auto"><Highlight text={nameOf(p)} query={query} /></span>
                  {p.isPublic === false && <Lock className="h-3.5 w-3.5 text-[var(--fanous-color-text-muted)]" aria-label={t.playlist.privateLabel} />}
                </label>
              ))
            )}
          </fieldset>

          {!creating ? (
            <button type="button" className={quietButton} onClick={() => { setCreating(true); setMessage(null); }} data-testid={`${testId}-new`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {s.newPlaylist}
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-3 border-t border-[var(--fanous-color-divider)] pt-3" data-testid={`${testId}-create-form`} noValidate>
              <div>
                <label htmlFor={`${base}-name`} className="mb-1 block text-xs font-medium text-[var(--fanous-color-text-primary)]">{t.playlist.nameLabel}</label>
                <input
                  id={`${base}-name`}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.playlist.namePlaceholder}
                  maxLength={TITLE_MAX}
                  className={field}
                  data-testid={`${testId}-name`}
                  autoFocus
                />
              </div>
              <fieldset>
                <legend className="mb-1 block text-xs font-medium text-[var(--fanous-color-text-primary)]">{t.playlist.visibilityLabel}</legend>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
                  {[true, false].map((value) => (
                    <label key={String(value)} className="flex cursor-pointer items-start gap-2 text-sm text-[var(--fanous-color-text-primary)]">
                      <input
                        type="radio"
                        name={`${base}-visibility`}
                        className="mt-0.5 h-4 w-4 accent-[var(--fanous-color-primary)]"
                        checked={isPublic === value}
                        onChange={() => setIsPublic(value)}
                        data-testid={`${testId}-visibility-${value ? 'public' : 'private'}`}
                      />
                      <span>
                        <span className="block">{value ? t.playlist.publicLabel : t.playlist.privateLabel}</span>
                        <span className="block text-xs text-[var(--fanous-color-text-secondary)]">{value ? t.playlist.publicDescription : t.playlist.privateDescription}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor={`${base}-description`} className="mb-1 block text-xs font-medium text-[var(--fanous-color-text-primary)]">{s.descriptionOptional}</label>
                <textarea
                  id={`${base}-description`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.playlist.descriptionPlaceholder}
                  maxLength={DESCRIPTION_MAX}
                  rows={2}
                  className={field}
                  data-testid={`${testId}-description`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryButton} disabled={busy} data-testid={`${testId}-create`}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {busy ? s.creating : s.create}
                </button>
                <button type="button" className={quietButton} onClick={resetForm} disabled={busy}>
                  {s.cancel}
                </button>
              </div>
            </form>
          )}

          {message && (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm ${message.kind === 'error' ? 'text-[var(--fanous-color-error-text)]' : 'text-[var(--fanous-color-success-text)]'}`}
              data-testid={`${testId}-message`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
