'use client';

/**
 * Manage Playlists (channel settings): the channel's playlists. Each one
 * opens its editor (details, order, videos); "New playlist" opens the create
 * form with the video picker. Delete stays here. A page at a time ("Show more
 * playlists"), with a search over every playlist (hooks/usePlaylistPages.ts).
 */

import { playlistName } from '@/lib/playlists/playlist-names';
import React, { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { AlertTriangle, ArrowDownUp, ExternalLink, ListVideo, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { playlistSortOf } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { reportError } from '@/lib/errors/reporter';
import { PlaylistCover } from '@/components/PlaylistCover';
import { deletePlaylist, type PlaylistWithVideos } from '@/lib/api/playlists';
import { usePlaylistPages } from '@/hooks/usePlaylistPages';
import { getPlaylistHref } from '@/lib/playlists/playlist-utils';
import { directionLabels, fieldLabel } from '@/components/playlists/PlaylistDetailsFields';
import { fill } from '@/components/playlists/text';
import { DIVIDE, MUTED, NOTICE, TEXT } from '@/components/playlists/styles';
import { formatVideoCount } from '@/lib/format/videoMeta';

import { MetaSep } from '@/components/ui/MetaSep';
import { joinMeta } from '@/lib/i18n/meta-separator';
interface PlaylistManagerProps {
  channelId: string;
}


/** Manage Playlists of a channel, or (channelId '') the user's personal playlists under You. */
export function managePlaylistsHref(lang: string, channelId: string, playlistId?: string): string {
  const base = channelId ? `/${lang}/settings/channel/${channelId}/playlists` : `/${lang}/library/playlists`;
  return playlistId ? `${base}/${encodeURIComponent(playlistId)}` : base;
}

export default function PlaylistManager({ channelId }: PlaylistManagerProps) {
  const { t, lang, isRTL } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const p = t.playlistTools;
  const [error, setError] = useState<{ message: string; ref?: string; retry?: () => void } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Deleted here (the loaded pages still hold them)
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');

  // A channel's playlists, or (no channel) the user's personal ones, a page at a time
  const pages = usePlaylistPages(channelId, { query: search });
  const playlists = pages.items.filter((playlist) => !deleted.has(playlist.id));
  const loading = pages.loading;

  useEffect(() => {
    // A list error clears once the list loads (a retry, another search); a delete error stays
    if (!pages.failed) {
      setError((shown) => (shown?.retry ? null : shown));
      return;
    }
    setError({
      message: t.playlist.loadFailed,
      ref: reportError(new Error('Listing playlists failed'), { shown: true, extra: { step: 'playlist-manager-load', channelId } }),
      retry: pages.retry,
    });
  }, [pages.failed, pages.retry, channelId, t]);

  const handleDelete = async (playlist: PlaylistWithVideos) => {
    const title = playlistName(playlist, lang);
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
      setDeleted((prev) => new Set(prev).add(playlist.id));
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
          <p className={MUTED}>{channelId ? t.playlist.managePlaylistsDescription : t.playlist.personalPlaylistsDescription}</p>
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
            {error.ref && <p className="text-xs">{fill(p.errorRef, { ref: error.ref }, lang)}</p>}
          </div>
          {error.retry && (
            <button type="button" className="b b-secondary b-sm flex-none" onClick={() => { setError(null); error.retry?.(); }}>{p.tryAgain}</button>
          )}
        </div>
      )}

      <div role="search" className="relative max-w-md">
        <label htmlFor="playlist-manager-search" className="sr-only">{t.playlist.searchYourPlaylists}</label>
        <Search className={`pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 ${MUTED}`} aria-hidden="true" />
        <input
          id="playlist-manager-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.playlist.searchYourPlaylists}
          autoComplete="off"
          className="f-input f-icon-start w-full py-2 text-sm"
          data-testid="playlist-manager-search"
        />
      </div>

      {loading ? (
        <ul className="c !p-0" aria-busy="true" aria-label={t.common.loading}>
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-4 p-4"><span className="sk h-16 w-28 flex-none" /><span className="sk h-4 flex-1" /></li>
          ))}
        </ul>
      ) : playlists.length === 0 && !error ? (
        <div className="empty c">
          <ListVideo className="h-10 w-10" aria-hidden="true" />
          <p>{pages.searched ? t.playlist.noMatchingPlaylists : t.playlist.noPlaylists}</p>
        </div>
      ) : (
        <ul className={`c !p-0 ${DIVIDE}`} data-testid="playlist-manager-list">
          {playlists.map((playlist) => {
            const title = playlistName(playlist, lang);
            const count = playlist.videos?.length ?? playlist.videosCount ?? 0;
            const sort = playlistSortOf(playlist);
            const editHref = managePlaylistsHref(lang, channelId, playlist.id);
            return (
              <li key={playlist.id} className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap" data-testid="playlist-manager-item" data-playlist-id={playlist.id}>
                <Link href={editHref} className="w-28 flex-none overflow-hidden rounded-[var(--r-sm)]" tabIndex={-1} aria-hidden="true">
                  <PlaylistCover playlist={playlist} alt="" sizes="112px" />
                </Link>
                <div className="min-w-0 flex-1">
                  <h3 className={`truncate font-semibold ${TEXT}`}>
                    <Link href={editHref} className="hover:underline">{title}</Link>
                  </h3>
                  {/* A separator never ends a line: each item after the first carries its own leading
                      bullet, so a wrapped item takes its bullet with it */}
                  <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${MUTED}`} data-testid="playlist-details">
                    <span>{formatVideoCount(count, lang)}</span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <MetaSep lang={lang} gap="0.5rem" className="me-1" />
                      {playlist.isPublic === false && <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                      {playlist.isPublic === false ? t.playlist.privateLabel : t.playlist.publicLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap" data-testid="playlist-sort-summary">
                      <MetaSep lang={lang} gap="0.5rem" className="me-1" />
                      <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
                      {sort.sortMode === 'auto'
                        ? joinMeta(lang, [fieldLabel(sort.sortField, t), directionLabels(sort.sortField, t)[sort.sortDirection]], '·')
                        : p.sortManual}
                    </span>
                  </p>
                </div>
                {/* Phones: the actions get a row of their own, so the title and details keep the width
                    (they were cut to "Wee…" with one word per line) */}
                <div className="flex basis-full items-center justify-end gap-1 sm:flex-none sm:basis-auto" data-testid="playlist-manager-actions">
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
                    data-testid="playlist-delete"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && (pages.hasMore || pages.moreFailed) && (
        <div className="flex flex-col items-center gap-2">
          {pages.moreFailed && <p role="alert" className="text-sm text-[var(--fanous-color-error-text)]">{t.playlist.morePlaylistsFailed}</p>}
          <button type="button" className="b b-secondary" onClick={pages.loadMore} disabled={pages.loadingMore} data-testid="playlist-manager-more">
            {pages.loadingMore ? t.common.loading : t.playlist.showMorePlaylists}
          </button>
        </div>
      )}
    </div>
  );
}
