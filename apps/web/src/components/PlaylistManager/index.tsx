'use client';

/**
 * Channel playlist management (channel settings): create, edit and delete
 * the channel's playlists.
 */

import { pickLanguage } from '@/lib/format/pick-language';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Edit, ExternalLink, ListVideo, Lock, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { PlaylistCover } from '@/components/PlaylistCover';
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  updatePlaylist,
  type PlaylistWithVideos,
} from '@/lib/api/playlists';
import { getPlaylistHref, normalizePlaylistTitle } from '@/lib/playlists/playlist-utils';

interface PlaylistManagerProps {
  channelId: string;
}

interface FormState {
  id: string | null; // null = creating
  title: string;
  description: string;
  isPublic: boolean;
}

const EMPTY_FORM: FormState = { id: null, title: '', description: '', isPublic: true };
const MAX_PLAYLISTS = 100;

export default function PlaylistManager({ channelId }: PlaylistManagerProps) {
  const { t, lang, isRTL } = useLanguage();
  const [playlists, setPlaylists] = useState<PlaylistWithVideos[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listPlaylists({ channelId, limit: MAX_PLAYLISTS });
      if (!result) {
        setError(t.playlist.loadFailed);
      }
      setPlaylists(result?.data || []);
    } catch (err) {
      logger.error('[PlaylistManager] Failed to load playlists', { channelId, error: err });
      setError(t.playlist.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [channelId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const startCreate = () => {
    setError(null);
    setForm({ ...EMPTY_FORM });
  };

  const startEdit = (playlist: PlaylistWithVideos) => {
    setError(null);
    setForm({
      id: playlist.id,
      title: playlist.name || playlist.title || '',
      description: playlist.description || '',
      isPublic: playlist.isPublic !== false,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;

    const title = normalizePlaylistTitle(form.title);
    if (!title) {
      setError(t.playlist.nameRequired);
      return;
    }

    setSaving(true);
    setError(null);
    const description = form.description.trim();

    if (form.id) {
      const result = await updatePlaylist(form.id, { title, description, isPublic: form.isPublic }, { channelId });
      setSaving(false);
      if (!result?.success) {
        logger.error('[PlaylistManager] Update failed', { playlistId: form.id, error: result?.error });
        setError(t.playlist.updateFailed);
        return;
      }
      setPlaylists((prev) => prev.map((p) => p.id === form.id
        ? { ...p, title, name: title, description, isPublic: form.isPublic }
        : p));
      logger.debug('[PlaylistManager] Playlist updated', { playlistId: form.id });
    } else {
      const result = await createPlaylist({ name: title, description, isPublic: form.isPublic }, { channelId });
      setSaving(false);
      const created = result?.result?.playlist;
      if (!result?.success || !created) {
        logger.error('[PlaylistManager] Create failed', { channelId, error: result?.error });
        setError(t.playlist.createFailed);
        return;
      }
      setPlaylists((prev) => [{ ...created, name: created.name || title, videos: [] }, ...prev]);
      logger.debug('[PlaylistManager] Playlist created', { playlistId: created.id });
    }

    setForm(null);
  };

  const handleDelete = async (playlist: PlaylistWithVideos) => {
    const title = playlist.name || playlist.title;
    if (!window.confirm(t.playlist.confirmDelete.replace('{title}', title))) return;

    setDeletingId(playlist.id);
    setError(null);
    const result = await deletePlaylist(playlist.id, { channelId });
    setDeletingId(null);

    if (!result?.success) {
      logger.error('[PlaylistManager] Delete failed', { playlistId: playlist.id });
      setError(t.playlist.deleteFailed);
      return;
    }
    setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
    if (form?.id === playlist.id) setForm(null);
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.playlist.managePlaylists}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t.playlist.managePlaylistsDescription}</p>
        </div>
        {!form && (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            <Plus className="w-4 h-4" />
            {t.playlist.newPlaylist}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {form.id ? t.playlist.editPlaylist : t.playlist.createPlaylist}
          </h2>

          <div>
            <label htmlFor="playlist-title" className="block text-sm font-medium mb-1 dark:text-white">
              {t.playlist.nameLabel}
            </label>
            <input
              id="playlist-title"
              type="text"
              value={form.title}
              maxLength={150}
              required
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t.playlist.namePlaceholder}
              className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white"
            />
          </div>

          <div>
            <label htmlFor="playlist-description" className="block text-sm font-medium mb-1 dark:text-white">
              {t.playlist.descriptionLabel}
            </label>
            <textarea
              id="playlist-description"
              value={form.description}
              rows={3}
              maxLength={5000}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t.playlist.descriptionPlaceholder}
              className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white resize-none"
            />
          </div>

          <fieldset>
            <legend className="block text-sm font-medium mb-2 dark:text-white">{t.playlist.visibilityLabel}</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {[true, false].map((isPublic) => (
                <label
                  key={String(isPublic)}
                  className="flex items-start gap-3 p-3 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <input
                    type="radio"
                    name="playlist-visibility"
                    checked={form.isPublic === isPublic}
                    onChange={() => setForm({ ...form, isPublic })}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium dark:text-white">
                      {isPublic ? t.playlist.publicLabel : t.playlist.privateLabel}
                    </span>
                    <span className="block text-sm text-gray-600 dark:text-gray-400">
                      {isPublic ? t.playlist.publicDescription : t.playlist.privateDescription}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
            >
              {saving ? t.common.saving : t.common.save}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              disabled={saving}
              className="px-6 py-2 rounded-lg border dark:border-gray-600 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-600 dark:text-gray-400">{t.common.loading}</p>
      ) : playlists.length === 0 ? (
        <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <ListVideo className="w-10 h-10 mx-auto text-gray-400 mb-2" />
          <p className="text-gray-600 dark:text-gray-400">{t.playlist.noPlaylists}</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg">
          {playlists.map((playlist) => {
            const title = pickLanguage(playlist.name || playlist.title || '', lang);
            const count = playlist.videos?.length ?? playlist.videosCount ?? 0;
            return (
              <li key={playlist.id} className="flex items-center gap-4 p-4">
                <div className="w-28 flex-shrink-0 rounded overflow-hidden">
                  <PlaylistCover playlist={playlist} alt={title} sizes="112px" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 dark:text-white truncate">{title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    <span>{t.playlist.videoCount.replace('{count}', String(count))}</span>
                    <span aria-hidden="true">•</span>
                    <span className="inline-flex items-center gap-1">
                      {playlist.isPublic === false && <Lock className="w-3.5 h-3.5" />}
                      {playlist.isPublic === false ? t.playlist.privateLabel : t.playlist.publicLabel}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Link
                    href={getPlaylistHref(lang, playlist.id)}
                    className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-white"
                    aria-label={t.playlist.viewPlaylist}
                    title={t.playlist.viewPlaylist}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => startEdit(playlist)}
                    className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-white"
                    aria-label={t.playlist.editPlaylist}
                    title={t.playlist.editPlaylist}
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(playlist)}
                    disabled={deletingId === playlist.id}
                    className="p-2 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40"
                    aria-label={t.playlist.deletePlaylist}
                    title={t.playlist.deletePlaylist}
                  >
                    <Trash2 className="w-4 h-4" />
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
