'use client';

/**
 * Manage Playlists (channel settings): the channel's playlists. Each one
 * opens its editor (details, order, videos); "New playlist" opens the create
 * form with the video picker. Delete stays here.
 */

import { pickLanguage } from '@/lib/format/pick-language';
import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { AlertTriangle, ArrowDownUp, ExternalLink, ListVideo, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { playlistSortOf } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { reportError } from '@/lib/errors/reporter';
import { PlaylistCover } from '@/components/PlaylistCover';
import { deletePlaylist, listPlaylists, type PlaylistWithVideos } from '@/lib/api/playlists';
import { getPlaylistHref } from '@/lib/playlists/playlist-utils';
import { directionLabels, fieldLabel } from '@/components/playlists/PlaylistDetailsFields';
import { counted, fill } from '@/components/playlists/text';
import { DIVIDE, MUTED, NOTICE, TEXT } from '@/components/playlists/styles';

interface PlaylistManagerProps {
  channelId: string;
}

const MAX_PLAYLISTS = 100;

export function managePlaylistsHref(lang: string, channelId: string, playlistId?: string): string {
  const base = `/${lang}/settings/channel/${channelId}/playlists`;
  return playlistId ? `${base}/${encodeURIComponent(playlistId)}` : base;
}

export default function PlaylistManager({ channelId }: PlaylistManagerProps) {
  const { t, lang, isRTL } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const p = t.playlistTools;
  const [playlists, setPlaylists] = useState<PlaylistWithVideos[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; ref?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listPlaylists({ channelId, limit: MAX_PLAYLISTS });
      if (!result) {
        setError({ message: t.playlist.loadFailed, ref: reportError(new Error('Listing channel playlists failed'), { shown: true, extra: { step: 'playlist-manager-load', channelId } }) });
      }
      setPlaylists(result?.data || []);
    } catch (caught) {
      setError({ message: t.playlist.loadFailed, ref: reportError(caught, { shown: true, extra: { step: 'playlist-manager-load', channelId } }) });
    } finally {
      setLoading(false);
    }
  }, [channelId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (playlist: PlaylistWithVideos) => {
    const title = pickLanguage(playlist.name || playlist.title || '', lang);
    const confirmed = await confirm({
      title: t.confirmDialog.deletePlaylistTitle,
      description: t.playlist.confirmDelete.replace('{title}', title),
      confirmLabel: t.common.delete,
      testId: 'playlist-delete-dialog',
    });
    if (!confirmed) return;
    setDeletingId(playlist.id);
    setError(null);
    try {
      const result = await deletePlaylist(playlist.id, { channelId });
      if (!result?.success) {
        setError({ message: t.playlist.deleteFailed, ref: reportError(new Error('Deleting a playlist failed'), { shown: true, extra: { step: 'playlist-delete', playlistId: playlist.id } }) });
        return;
      }
      setPlaylists((prev) => prev.filter((item) => item.id !== playlist.id));
    } catch (caught) {
      setError({ message: t.playlist.deleteFailed, ref: reportError(caught, { shown: true, extra: { step: 'playlist-delete', playlistId: playlist.id } }) });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-bold ${TEXT}`}>{t.playlist.managePlaylists}</h1>
          <p className={MUTED}>{t.playlist.managePlaylistsDescription}</p>
        </div>
        <Link href={`${managePlaylistsHref(lang, channelId)}/new`} className="b b-primary" data-testid="new-playlist-link">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t.playlist.newPlaylist}
        </Link>
      </div>

      {error && (
        <div role="alert" className={`flex items-start gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm ${NOTICE.error}`}>
          <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">{error.message}</p>
            {error.ref && <p className="text-xs">{fill(p.errorRef, { ref: error.ref })}</p>}
          </div>
          <button type="button" className="b b-secondary b-sm flex-none" onClick={() => void load()}>{p.tryAgain}</button>
        </div>
      )}

      {loading ? (
        <ul className="c !p-0" aria-busy="true" aria-label={t.common.loading}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-4 p-4"><span className="sk h-16 w-28 flex-none" /><span className="sk h-4 flex-1" /></li>
          ))}
        </ul>
      ) : playlists.length === 0 && !error ? (
        <div className="empty c">
          <ListVideo className="h-10 w-10" aria-hidden="true" />
          <p>{t.playlist.noPlaylists}</p>
        </div>
      ) : (
        <ul className={`c !p-0 ${DIVIDE}`} data-testid="playlist-manager-list">
          {playlists.map((playlist) => {
            const title = pickLanguage(playlist.name || playlist.title || '', lang);
            const count = playlist.videos?.length ?? playlist.videosCount ?? 0;
            const sort = playlistSortOf(playlist);
            const editHref = managePlaylistsHref(lang, channelId, playlist.id);
            return (
              <li key={playlist.id} className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap">
                <Link href={editHref} className="w-28 flex-none overflow-hidden rounded-[var(--r-sm)]" tabIndex={-1} aria-hidden="true">
                  <PlaylistCover playlist={playlist} alt="" sizes="112px" />
                </Link>
                <div className="min-w-0 flex-1">
                  <h3 className={`truncate font-semibold ${TEXT}`}>
                    <Link href={editHref} className="hover:underline">{title}</Link>
                  </h3>
                  <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${MUTED}`}>
                    <span>{counted(count, p.countOne, p.countOther)}</span>
                    <span aria-hidden="true">•</span>
                    <span className="inline-flex items-center gap-1">
                      {playlist.isPublic === false && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                      {playlist.isPublic === false ? t.playlist.privateLabel : t.playlist.publicLabel}
                    </span>
                    <span aria-hidden="true">•</span>
                    <span className="inline-flex items-center gap-1" data-testid="playlist-sort-summary">
                      <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
                      {sort.sortMode === 'auto'
                        ? `${fieldLabel(sort.sortField, t)} · ${directionLabels(sort.sortField, t)[sort.sortDirection]}`
                        : p.sortManual}
                    </span>
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1">
                  <Link href={editHref} className="b b-secondary b-sm" aria-label={`${t.playlist.editPlaylist}: ${title}`} title={t.playlist.editPlaylist}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{t.playlist.editPlaylist}</span>
                  </Link>
                  <Link href={getPlaylistHref(lang, playlist.id)} className="b b-ghost b-icon" aria-label={t.playlist.viewPlaylist} title={t.playlist.viewPlaylist}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleDelete(playlist)}
                    disabled={deletingId === playlist.id}
                    className="b b-ghost b-icon text-[var(--fanous-color-error-text)] disabled:opacity-40"
                    aria-label={t.playlist.deletePlaylist}
                    title={t.playlist.deletePlaylist}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
