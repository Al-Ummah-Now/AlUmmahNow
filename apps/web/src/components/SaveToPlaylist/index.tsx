'use client';

/**
 * "Save to playlist" control for the watch page and the video cards' menu.
 *
 * Shown to signed-in users. With a channel active it lists that channel's
 * playlists; without one, the user's personal playlists (no channel needed).
 * A checkbox per playlist (checked = video is in it), and a new playlist the
 * video is added to immediately.
 */

import { playlistName } from '@/lib/playlists/playlist-names';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ListPlus, Lock, Plus, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useCurrentChannel } from '@/hooks/useMultiAccount';
import { logger } from '@/lib/logger-client';
import {
  addVideoToPlaylist,
  createPlaylist,
  listPlaylists,
  removeVideoFromPlaylist,
  type PlaylistWithVideos,
} from '@/lib/api/playlists';
import { normalizePlaylistTitle } from '@/lib/playlists/playlist-utils';
import { menuShift } from './menu-shift';

interface SaveToPlaylistProps {
  videoId: string;
  /** The channel whose playlists to use. Defaults to the active channel; without one, the user's personal playlists */
  channelId?: string;
  className?: string;
  /** Controlled: the dialog is opened from elsewhere (the card menu) and there is no button of its own */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const MAX_PLAYLISTS = 50;
export default function SaveToPlaylist({ videoId, channelId: channelIdProp, className = '', open: openProp, onOpenChange }: SaveToPlaylistProps) {
  const { t, isRTL } = useLanguage();
  const { user } = useAuth();
  const channel = useCurrentChannel();
  const channelId = channelIdProp ?? channel?.id;

  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = useCallback((next: boolean | ((was: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (!controlled) setOpenState(value);
    onOpenChange?.(value);
  }, [controlled, onOpenChange, open]);
  const [playlists, setPlaylists] = useState<PlaylistWithVideos[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu hangs from the button's start edge, which can leave it partly
  // off-screen (e.g. Safari at x = -183 when the button sits near the far edge
  // of a wrapped row). Measure it once open and slide it back into view.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const menu = menuRef.current;
      if (!menu) return;
      menu.style.transform = '';
      const rect = menu.getBoundingClientRect();
      const shift = menuShift(rect.left, rect.right, document.documentElement.clientWidth);
      menu.style.transform = shift ? `translateX(${Math.round(shift)}px)` : '';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // Playlists created in this dialog: a list load that started before them (it can take seconds,
  // #909) must not drop them when it lands
  const createdHere = useRef(new Map<string, PlaylistWithVideos>());

  const loadPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      // The active channel's playlists, or (no channel) the user's personal ones
      const result = await listPlaylists(channelId ? { channelId, limit: MAX_PLAYLISTS } : { mine: true, limit: MAX_PLAYLISTS });
      const loaded = result?.data || [];
      const loadedIds = new Set(loaded.map((p) => p.id));
      setPlaylists([...[...createdHere.current.values()].filter((p) => !loadedIds.has(p.id)), ...loaded]);
    } catch (error) {
      logger.error('[SaveToPlaylist] Failed to load playlists', { channelId, error });
      setMessage({ type: 'error', text: t.playlist.loadFailed });
    } finally {
      setLoading(false);
    }
  }, [channelId, t]);

  useEffect(() => {
    if (open) {
      setMessage(null);
      loadPlaylists();
    }
  }, [open, loadPlaylists]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  if (!user) return null;

  const toggle = async (playlist: PlaylistWithVideos) => {
    if (pendingId) return;
    const contains = (playlist.videos || []).includes(videoId);
    const title = playlistName(playlist, isRTL ? 'ar' : 'en');
    setPendingId(playlist.id);
    setMessage(null);

    const result = contains
      ? await removeVideoFromPlaylist(playlist.id, videoId, { channelId: playlist.channelId || channelId || '' })
      : await addVideoToPlaylist(playlist.id, { videoId }, { channelId: playlist.channelId || channelId || '' });

    setPendingId(null);

    if (!result?.success) {
      logger.error('[SaveToPlaylist] Toggle failed', { playlistId: playlist.id, videoId, contains });
      setMessage({ type: 'error', text: t.playlist.saveFailed });
      return;
    }

    setPlaylists((prev) => prev.map((p) => p.id !== playlist.id ? p : {
      ...p,
      videos: contains ? (p.videos || []).filter((id) => id !== videoId) : [...(p.videos || []), videoId],
    }));
    setMessage({
      type: 'success',
      text: (contains ? t.playlist.removedFrom : t.playlist.addedTo).replace('{title}', title),
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    const title = normalizePlaylistTitle(newTitle);
    if (!title) {
      setMessage({ type: 'error', text: t.playlist.nameRequired });
      return;
    }

    setCreating(true);
    setMessage(null);
    // No channel header without an active channel: a personal playlist, the user's own
    const created = await createPlaylist({ name: title, isPublic: newIsPublic }, { channelId: channelId || '' });
    const playlist = created?.result?.playlist;

    if (!created?.success || !playlist) {
      setCreating(false);
      logger.error('[SaveToPlaylist] Create failed', { channelId, error: created?.error });
      setMessage({ type: 'error', text: t.playlist.createFailed });
      return;
    }

    const added = await addVideoToPlaylist(playlist.id, { videoId }, { channelId: channelId || '' });
    setCreating(false);
    setNewTitle('');

    const entry: PlaylistWithVideos = {
      ...playlist,
      name: playlist.name || title,
      title: playlist.title || title,
      videos: added?.success ? [videoId] : [],
    };
    createdHere.current.set(entry.id, entry);
    setPlaylists((prev) => [entry, ...prev.filter((p) => p.id !== entry.id)]);
    setMessage(added?.success
      ? { type: 'success', text: t.playlist.addedTo.replace('{title}', title) }
      : { type: 'error', text: t.playlist.saveFailed });
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      {!controlled && <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="save-to-playlist-button"
        title={t.playlist.saveToPlaylist}
        className="inline-flex items-center gap-2 px-4 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-white"
      >
        <ListPlus size={20} />
        <span className="wa-label">{t.playlist.saveToPlaylist}</span>
      </button>}

      {open && (
        <div
          ref={menuRef}
          role="dialog"
          data-testid="save-to-playlist-menu"
          aria-label={t.playlist.saveToPlaylistTitle}
          className={`absolute z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] ${isRTL ? 'right-0' : 'left-0'} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">{t.playlist.saveToPlaylistTitle}</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              aria-label={t.common.close}
            >
              <X size={16} />
            </button>
          </div>

          {(
            <>
              <div className="max-h-64 overflow-y-auto py-2">
                {loading && playlists.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-gray-500">{t.common.loading}</p>
                ) : playlists.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-gray-500">{t.playlist.noPlaylists}</p>
                ) : (
                  playlists.map((playlist) => {
                    const checked = (playlist.videos || []).includes(videoId);
                    return (
                      <label
                        key={playlist.id}
                        data-playlist-id={playlist.id}
                        className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={checked}
                          disabled={pendingId !== null}
                          onChange={() => toggle(playlist)}
                        />
                        <span className="flex-1 min-w-0 truncate text-sm text-gray-900 dark:text-white">
                          {playlistName(playlist, isRTL ? 'ar' : 'en')}
                        </span>
                        {playlist.isPublic === false && (
                          <Lock className="w-3.5 h-3.5 text-gray-400" aria-label={t.playlist.privateLabel} />
                        )}
                      </label>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleCreate} className="border-t dark:border-gray-700 p-3 space-y-2" data-testid="save-to-playlist-create">
                <label className="sr-only" htmlFor={`new-playlist-${videoId}`}>{t.playlist.nameLabel}</label>
                <input
                  id={`new-playlist-${videoId}`}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t.playlist.namePlaceholder}
                  maxLength={150}
                  className="w-full px-3 py-2 text-sm border dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={!newIsPublic}
                      onChange={(e) => setNewIsPublic(!e.target.checked)}
                    />
                    {t.playlist.privateLabel}
                  </label>
                  <button
                    type="submit"
                    disabled={creating}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                  >
                    <Plus size={14} />
                    {creating ? t.common.saving : t.playlist.createAndAdd}
                  </button>
                </div>
              </form>
            </>
          )}

          {message && (
            <p
              role="status"
              className={`px-4 pb-3 text-sm ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
