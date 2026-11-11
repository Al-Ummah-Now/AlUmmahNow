'use client';

/**
 * "Add to playlist" for one or many videos (Video Management or Studio: a
 * row's menu, or the selection's bulk bar).
 *
 * With videos chosen: search the channel's playlists (the standard live
 * autocomplete, several can be ticked) and add the videos to every ticked
 * one; a manual playlist gets them at its end. Or "New playlist with N
 * videos": the create form with that selection, which can be put in order
 * before saving (no video picker: they are already chosen).
 * Opened with no videos: the create form with the video picker.
 *
 * Each playlist then shows what happened: added, queued for the background
 * with progress, or not added with Retry. Adds are idempotent, so nothing
 * lands twice.
 *
 * Exported for the upload flows too.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ListPlus, Lock, Plus, Search, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { addVideosToPlaylist, listPlaylists, type PlaylistWithVideos } from '@/lib/api/playlists';
import { reportError } from '@/lib/errors/reporter';
import { playlistName } from '@/lib/playlists/playlist-names';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import '@/theme/playlist-tools.css';
import BulkAddNotice, { type BulkAddOutcome } from './BulkAddNotice';
import CreatePlaylistForm, { type CreatedPlaylist } from './CreatePlaylistForm';
import type { PickedVideo } from './VideoPicker';
import { counted, fill } from './text';
import { FAINT, MUTED, NOTICE, TEXT } from './styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  /** The videos to add, in order. */
  videos: PickedVideo[];
  /** A playlist changed (the page may reload its counts). */
  onAdded?: () => void;
}

interface Sent {
  playlistId: string;
  title: string;
  videoIds: string[];
  outcome: BulkAddOutcome;
  justCreated?: boolean;
}

const MAX_PLAYLISTS = 100;

export default function AddToPlaylistDialog({ open, onOpenChange, channelId, videos, onAdded }: Props) {
  const { t, lang, isRTL } = useLanguage();
  const p = t.playlistTools;
  const [playlists, setPlaylists] = useState<PlaylistWithVideos[] | null>(null);
  // Counts after an add here (the listed playlists predate it)
  const [counts, setCounts] = useState<Map<string, number>>(() => new Map());
  const [loadFailed, setLoadFailed] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [creating, setCreating] = useState(videos.length === 0);
  const [query, setQuery] = useState('');
  // The create form's selection (videos can be taken out there): its title counts it
  const [createCount, setCreateCount] = useState(videos.length);
  const [adding, setAdding] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const result = await listPlaylists({ channelId, limit: MAX_PLAYLISTS });
      if (!result) throw new Error('listPlaylists returned no answer');
      setPlaylists(result.data || []);
    } catch (error) {
      reportError(error, { shown: true, extra: { step: 'add-to-playlist-load', channelId } });
      setLoadFailed(true);
      setPlaylists([]);
    }
  }, [channelId]);

  // A fresh start each time it opens
  useEffect(() => {
    if (!open) return;
    setChosen([]);
    setCreating(videos.length === 0);
    setCreateCount(videos.length);
    setQuery('');
    setHint(null);
    setSent([]);
    setPlaylists(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a fresh start per opening, not per selection change
  }, [open, load]);

  const videoIds = videos.map((v) => v.id);
  const titleOf = (playlist: PlaylistWithVideos) => playlistName(playlist, lang);
  const toggle = (id: string) => setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const addToChosen = async () => {
    if (chosen.length === 0) {
      setHint(p.chooseAtLeastOne);
      return;
    }
    setAdding(true);
    setHint(null);
    const targets = (playlists ?? []).filter((pl) => chosen.includes(pl.id));
    const results = await Promise.all(targets.map(async (playlist): Promise<Sent> => {
      const title = titleOf(playlist);
      try {
        const answer = await addVideosToPlaylist(playlist.id, videoIds, { channelId });
        if (answer.ok) return { playlistId: playlist.id, title, videoIds, outcome: { kind: 'result', result: answer.data } };
        const ref = reportError(new Error('Adding videos to a playlist failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'add-to-playlist', playlistId: playlist.id, count: videoIds.length } });
        return { playlistId: playlist.id, title, videoIds, outcome: { kind: 'request-failed', status: answer.status, ref } };
      } catch (error) {
        const ref = reportError(error, { shown: true, extra: { step: 'add-to-playlist', playlistId: playlist.id, count: videoIds.length } });
        return { playlistId: playlist.id, title, videoIds, outcome: { kind: 'request-failed', status: null, ref } };
      }
    }));
    setSent((prev) => [...prev, ...results]);
    // The rows show each playlist's count: take the new one from the add's answer
    setCounts((prev) => {
      const next = new Map(prev);
      for (const r of results) if (r.outcome.kind === 'result') next.set(r.playlistId, r.outcome.result.videosCount);
      return next;
    });
    setChosen([]);
    setAdding(false);
  };

  const created = ({ playlist, videoIds: ids, add }: CreatedPlaylist) => {
    setCreating(false);
    const title = playlistName(playlist, lang);
    setPlaylists((prev) => [playlist, ...(prev ?? [])]);
    const outcome: BulkAddOutcome = add
      ? { kind: 'result', result: add }
      : { kind: 'result', result: { status: 'done', added: 0, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: 0 } };
    setSent((prev) => [...prev, { playlistId: playlist.id, title, videoIds: ids, outcome, justCreated: true }]);
    onAdded?.();
  };

  const sentIds = new Set(sent.map((s) => s.playlistId));
  const fromSelection = videos.length > 0;
  const dialogTitle = !creating
    ? counted(videos.length, p.dialogTitleOne, p.dialogTitleOther)
    : fromSelection
      ? counted(createCount, p.newWithOne, p.newWithOther)
      : p.newPlaylistHeading;
  const dialogText = !creating ? p.dialogDescriptionSelected : fromSelection ? p.newPlaylistHelpSelected : p.newPlaylistHelp;

  const countOf = (playlist: PlaylistWithVideos) => counts.get(playlist.id) ?? playlist.videos?.length ?? playlist.videosCount ?? 0;
  const options: AutocompleteOption[] = (playlists ?? []).map((playlist) => ({
    id: playlist.id,
    label: titleOf(playlist),
    subtitle: `${playlist.isPublic === false ? t.playlist.privateLabel : t.playlist.publicLabel} · ${counted(countOf(playlist), p.countOne, p.countOther)}`,
    icon: playlist.isPublic === false ? <Lock className="h-4 w-4" /> : <ListPlus className="h-4 w-4" />,
    // Both names match a search, whichever language is typed
    keywords: [playlist.name, playlist.title, ...Object.values(playlist.titleLocalized ?? {})].filter((k): k is string => typeof k === 'string'),
    value: playlist,
  }));
  const chosenPlaylists = (playlists ?? []).filter((pl) => chosen.includes(pl.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,52rem)] w-[calc(100%-2rem)] flex-col gap-4 overflow-hidden !p-0"
        style={{ maxWidth: creating ? '48rem' : '34rem' }}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="add-to-playlist-dialog"
      >
        <div className="px-6 pt-6">
          <DialogTitle className={`pe-10 text-lg font-bold ${TEXT}`}>{dialogTitle}</DialogTitle>
          <DialogDescription className={`mt-1 text-sm ${MUTED}`}>{dialogText}</DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-2">
          {sent.length > 0 && (
            <div className="space-y-2" data-testid="add-to-playlist-results">
              {sent.map((s) => (
                <BulkAddNotice
                  key={s.playlistId}
                  playlistId={s.playlistId}
                  playlistTitle={s.title}
                  channelId={channelId}
                  outcome={s.outcome}
                  videoIds={s.videoIds}
                  justCreated={s.justCreated}
                  onChanged={onAdded}
                />
              ))}
            </div>
          )}

          {creating ? (
            <CreatePlaylistForm
              channelId={channelId}
              initialVideos={videos}
              fixedVideos={fromSelection}
              onVideosChange={(next) => setCreateCount(next.length)}
              compact
              idPrefix="inline-playlist"
              onCreated={created}
              // From a selection, back to the playlists; without one there is nowhere to go back to
              onCancel={fromSelection ? () => setCreating(false) : () => onOpenChange(false)}
              cancelLabel={fromSelection ? p.backToPlaylists : undefined}
            />
          ) : (
            <div className="space-y-3">
              <label htmlFor="add-to-playlist-search" className={`block text-sm font-semibold ${TEXT}`}>{p.yourPlaylists}</label>
              {playlists === null ? (
                <ul className="space-y-2" aria-busy="true">
                  {Array.from({ length: 3 }, (_, i) => <li key={i} className="sk h-12" />)}
                </ul>
              ) : loadFailed ? (
                <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm ${NOTICE.error}`}>
                  <span>{t.playlist.loadFailed}</span>
                  <button type="button" className="b b-secondary b-sm" onClick={() => void load()}>{p.tryAgain}</button>
                </div>
              ) : playlists.length === 0 ? (
                <p className={`text-sm ${MUTED}`}>{p.noPlaylistsYet}</p>
              ) : (
                // The standard live autocomplete, listed in place: type to narrow, tick several
                <Autocomplete
                  mode="inline"
                  value={query}
                  onValueChange={setQuery}
                  options={options}
                  emptyOptions={options}
                  maxOptions={MAX_PLAYLISTS}
                  keepOpenOnSelect
                  onSelect={(option) => {
                    if (sentIds.has(option.id) || adding) return;
                    setHint(null);
                    toggle(option.id);
                  }}
                  decorate={(option) => ({ selected: chosen.includes(option.id) || sentIds.has(option.id), disabled: sentIds.has(option.id) || adding })}
                  label={p.searchPlaylists}
                  listLabel={p.yourPlaylists}
                  inputId="add-to-playlist-search"
                  inputProps={{ type: 'search', placeholder: p.searchPlaylists }}
                  inputClassName="f-input f-icon-start w-full py-2 text-sm"
                  testId="add-to-playlist-search"
                  popupTestId="add-to-playlist-options"
                  optionTestId={() => 'add-to-playlist-option'}
                >
                  <Search className={`pointer-events-none absolute start-3 top-[22px] h-4 w-4 -translate-y-1/2 ${FAINT}`} aria-hidden="true" />
                </Autocomplete>
              )}

              {chosenPlaylists.length > 0 && (
                <div className="space-y-1.5" data-testid="add-to-playlist-chosen">
                  <h3 className={`text-xs font-semibold ${MUTED}`}>{p.chosenPlaylists}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {chosenPlaylists.map((playlist) => {
                      const title = titleOf(playlist);
                      return (
                        <li key={playlist.id} className="pl-pill inline-flex max-w-full items-center gap-1 ps-3" data-playlist-id={playlist.id}>
                          <span className={`max-w-[16rem] truncate text-sm ${TEXT}`} dir="auto">{title}</span>
                          <button type="button" className="pl-pill-x" onClick={() => toggle(playlist.id)} disabled={adding} aria-label={fill(p.removeChosen, { title })}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <button type="button" className="b b-secondary w-full justify-center" onClick={() => setCreating(true)} disabled={adding} data-testid="add-to-playlist-new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {counted(videos.length, p.newWithOne, p.newWithOther)}
              </button>
            </div>
          )}

          {hint && <p role="alert" className="text-sm text-[var(--fanous-color-error-text)]">{hint}</p>}
        </div>

        {!creating && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--fanous-color-divider)] px-6 py-4">
            <button type="button" className="b b-secondary" onClick={() => onOpenChange(false)} data-testid="add-to-playlist-done">
              {sent.length > 0 ? p.done : t.playlist.upload.cancel}
            </button>
            <button type="button" className="b b-primary" onClick={() => void addToChosen()} disabled={adding || videos.length === 0} data-testid="add-to-playlist-submit">
              <ListPlus className="h-4 w-4" aria-hidden="true" />
              {adding ? p.adding : chosen.length > 0 ? counted(chosen.length, p.addToOne, p.addToOther) : p.addToPlaylist}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

