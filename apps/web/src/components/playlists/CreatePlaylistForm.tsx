'use client';

/**
 * Create a playlist with its videos in one flow: name, description,
 * visibility, order, and the videos picked from the channel (in the order
 * they were picked). One request creates the playlist and adds the videos;
 * the API validates every id.
 *
 * What the caller gets (onCreated):
 *   the new playlist, and what happened to its videos: added, queued for the
 *   background (more than 200), or not added yet (the playlist stays; the
 *   notice offers Retry). A playlist that was not created shows a friendly
 *   error here and goes to the error reporter.
 *
 * Used by Manage Playlists (full form) and "Add to playlist" (compact, the
 * picker starting from the videos chosen in Video Management).
 */

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PlaylistBulkAddResult } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { createManagedPlaylist, type PlaylistWithVideos } from '@/lib/api/playlists';
import { reportError } from '@/lib/errors/reporter';
import PlaylistDetailsFields, { EMPTY_PLAYLIST_DETAILS, type PlaylistDetailsValue } from './PlaylistDetailsFields';
import VideoPicker, { type PickedVideo } from './VideoPicker';
import { counted, fill } from './text';
import { LABEL, NOTICE } from './styles';

export interface CreatedPlaylist {
  playlist: PlaylistWithVideos;
  /** The ids sent, in order (a Retry re-sends them). */
  videoIds: string[];
  /** What happened to the videos: absent when none were chosen. */
  add?: PlaylistBulkAddResult;
}

interface Props {
  channelId: string;
  /** Videos chosen before the form opened (Video Management selection). */
  initialVideos?: PickedVideo[];
  /** Inline create ("Add to playlist"): no description, a shorter picker page. */
  compact?: boolean;
  onCreated: (created: CreatedPlaylist) => void;
  onCancel?: () => void;
  idPrefix?: string;
}

export default function CreatePlaylistForm({ channelId, initialVideos, compact, onCreated, onCancel, idPrefix = 'new-playlist' }: Props) {
  const { t } = useLanguage();
  const p = t.playlistTools;
  const [details, setDetails] = useState<PlaylistDetailsValue>(EMPTY_PLAYLIST_DETAILS);
  const [videos, setVideos] = useState<PickedVideo[]>(initialVideos ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; ref?: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = details.title.trim();
    if (!title) {
      setError({ message: t.playlist.nameRequired });
      return;
    }
    setSaving(true);
    setError(null);
    const videoIds = videos.map((v) => v.id);
    try {
      const answer = await createManagedPlaylist({
        name: title,
        title,
        description: details.description.trim() || undefined,
        isPublic: details.isPublic,
        sortMode: details.sortMode,
        sortField: details.sortField,
        sortDirection: details.sortDirection,
        videoIds,
      }, { channelId });
      if (answer.ok) {
        onCreated({ playlist: answer.data.playlist, videoIds, ...(answer.data.add ? { add: answer.data.add } : {}) });
        return;
      }
      const ref = reportError(new Error('Creating a playlist failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-create', channelId, count: videoIds.length } });
      setError({ message: answer.status === 403 ? fill(p.addForbidden, { title }) : t.playlist.createFailed, ref });
    } catch (caught) {
      const ref = reportError(caught, { shown: true, extra: { step: 'playlist-create', channelId, count: videoIds.length } });
      setError({ message: t.playlist.createFailed, ref });
    } finally {
      setSaving(false);
    }
  };

  const submitLabel = saving
    ? p.creating
    : videos.length > 0
      ? counted(videos.length, p.createWithOne, p.createWithOther)
      : t.playlist.createPlaylist;

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="create-playlist-form" noValidate>
      <PlaylistDetailsFields value={details} onChange={setDetails} idPrefix={idPrefix} compact={compact} disabled={saving} />

      <section aria-labelledby={`${idPrefix}-videos-label`} className="space-y-2">
        <h3 id={`${idPrefix}-videos-label`} className={LABEL}>{p.addVideosOptional}</h3>
        <VideoPicker channelId={channelId} selected={videos} onChange={setVideos} idPrefix={`${idPrefix}-picker`} pageSize={compact ? 12 : 24} />
      </section>

      {error && (
        <div role="alert" className={`flex items-start gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm ${NOTICE.error}`} data-testid="create-playlist-error">
          <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{error.message}</p>
            {error.ref && <p className="text-xs">{fill(p.errorRef, { ref: error.ref })}</p>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" className="b b-secondary" onClick={onCancel} disabled={saving}>
            {t.playlist.upload.cancel}
          </button>
        )}
        <button type="submit" className="b b-primary" disabled={saving} data-testid="create-playlist-submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
