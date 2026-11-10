'use client';

/**
 * "Add to playlist" for one or many videos (Video Management: a row's menu,
 * or the selection's bulk bar). Choose one or more of the channel's
 * playlists, or create one inline (with the same video picker, starting
 * from the chosen videos, in their order). Each playlist then shows what
 * happened: added, queued for the background with progress, or not added
 * with Retry. Adds are idempotent, so nothing lands twice.
 *
 * Exported for the upload flows too.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Check, ListPlus, Lock, Plus } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { addVideosToPlaylist, listPlaylists, type PlaylistWithVideos } from '@/lib/api/playlists';
import { reportError } from '@/lib/errors/reporter';
import { pickLanguage } from '@/lib/format/pick-language';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import '@/theme/playlist-tools.css';
import BulkAddNotice, { type BulkAddOutcome } from './BulkAddNotice';
import CreatePlaylistForm, { type CreatedPlaylist } from './CreatePlaylistForm';
import type { PickedVideo } from './VideoPicker';
import { counted } from './text';
import { MUTED, NOTICE, TEXT } from './styles';

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
  const [creating, setCreating] = useState(false);
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
    setCreating(false);
    setHint(null);
    setSent([]);
    setPlaylists(null);
    void load();
  }, [open, load]);

  const videoIds = videos.map((v) => v.id);
  const titleOf = (playlist: PlaylistWithVideos) => pickLanguage(playlist.name || playlist.title || '', lang);
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
    const title = pickLanguage(playlist.name || playlist.title || '', lang);
    setPlaylists((prev) => [playlist, ...(prev ?? [])]);
    const outcome: BulkAddOutcome = add
      ? { kind: 'result', result: add }
      : { kind: 'result', result: { status: 'done', added: 0, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: 0 } };
    setSent((prev) => [...prev, { playlistId: playlist.id, title, videoIds: ids, outcome, justCreated: true }]);
    onAdded?.();
  };

  const sentIds = new Set(sent.map((s) => s.playlistId));
  const dialogTitle = counted(videos.length, p.dialogTitleOne, p.dialogTitleOther);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="dl flex max-h-[min(90vh,52rem)] w-[calc(100%-2rem)] flex-col gap-4 overflow-hidden !p-0"
        style={{ maxWidth: creating ? '48rem' : '34rem' }}
        dir={isRTL ? 'rtl' : 'ltr'}
        data-testid="add-to-playlist-dialog"
      >
        <div className="px-6 pt-6">
          <DialogTitle className={`pe-10 text-lg font-bold ${TEXT}`}>{dialogTitle}</DialogTitle>
          <DialogDescription className={`mt-1 text-sm ${MUTED}`}>{creating ? p.newPlaylistHelp : p.dialogDescription}</DialogDescription>
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
              compact
              idPrefix="inline-playlist"
              onCreated={created}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <fieldset className="space-y-2">
              <legend className={`mb-2 text-sm font-semibold ${TEXT}`}>{p.yourPlaylists}</legend>
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
                <ul className="space-y-1" data-testid="add-to-playlist-options">
                  {playlists.map((playlist) => {
                    const title = titleOf(playlist);
                    const checked = chosen.includes(playlist.id);
                    const done = sentIds.has(playlist.id);
                    const count = counts.get(playlist.id) ?? playlist.videos?.length ?? playlist.videosCount ?? 0;
                    return (
                      <li key={playlist.id}>
                        <label className={`pl-row relative flex items-center gap-3 p-2.5 ${done ? 'opacity-60' : 'cursor-pointer'}`} data-selected={checked || undefined}>
                          <input type="checkbox" className="peer pl-hit" checked={checked || done} disabled={done || adding} onChange={() => toggle(playlist.id)} data-testid="add-to-playlist-option" data-playlist-id={playlist.id} />
                          <span className="ck pl-ck" data-on={checked || done || undefined} aria-hidden="true">{(checked || done) && <Check />}</span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm font-medium ${TEXT}`}>{title}</span>
                            <span className={`flex items-center gap-1 text-xs ${MUTED}`}>
                              {playlist.isPublic === false && <Lock className="h-3 w-3" aria-hidden="true" />}
                              {playlist.isPublic === false ? t.playlist.privateLabel : t.playlist.publicLabel}
                              <span aria-hidden="true">·</span>
                              {counted(count, p.countOne, p.countOther)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" className="b b-ghost mt-1 w-full justify-start" onClick={() => setCreating(true)} data-testid="add-to-playlist-new">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {p.newPlaylistInline}
              </button>
            </fieldset>
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

