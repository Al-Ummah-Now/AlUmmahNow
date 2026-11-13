'use client';

/**
 * Create a playlist with its videos in one flow: name and description in
 * English and Arabic, visibility, order, and its videos. With a manual order
 * the videos can be put in order (drag, keyboard, Move buttons) before
 * saving; that order is saved. One request creates the playlist and adds the
 * videos; the API validates every id.
 *
 * Videos come from the picker (Manage Playlists → New playlist), or, when the
 * form opens with a selection (Video Management → Add to playlist → New
 * playlist), are that selection: no picker, just the ordered list.
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
import PlaylistDetailsFields, { EMPTY_PLAYLIST_DETAILS, detailsVisibility, type PlaylistDetailsValue } from './PlaylistDetailsFields';
import VideoPicker, { type PickedVideo } from './VideoPicker';
import { counted, fill } from './text';
import { LABEL, MUTED, NOTICE, TEXT } from './styles';
import SortableVideoList from './SortableVideoList';
import { pairPayload } from '@/lib/playlists/playlist-names';

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
  /** The videos are the selection: no picker (they can still be ordered or taken out). */
  fixedVideos?: boolean;
  /** Called as the selection changes (the dialog's title counts it) */
  onVideosChange?: (videos: PickedVideo[]) => void;
  /** Label of the cancel button (default "Cancel") */
  cancelLabel?: string;
  /** Inline create ("Add to playlist"): no description, a shorter picker page. */
  compact?: boolean;
  onCreated: (created: CreatedPlaylist) => void;
  onCancel?: () => void;
  idPrefix?: string;
}

export default function CreatePlaylistForm({ channelId, initialVideos, fixedVideos, onVideosChange, cancelLabel, compact, onCreated, onCancel, idPrefix = 'new-playlist' }: Props) {
  const { t } = useLanguage();
  const p = t.playlistTools;
  const [details, setDetails] = useState<PlaylistDetailsValue>(EMPTY_PLAYLIST_DETAILS);
  const [videos, setVideosState] = useState<PickedVideo[]>(initialVideos ?? []);
  const setVideos = (next: PickedVideo[]) => {
    setVideosState(next);
    onVideosChange?.(next);
  };
  const manual = details.sortMode === 'manual';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; ref?: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = pairPayload({ en: details.titleEn, ar: details.titleAr });
    const about = pairPayload({ en: details.descriptionEn, ar: details.descriptionAr });
    const title = name.base;
    if (!title) {
      setError({ message: p.nameOneLanguage });
      return;
    }
    if (fixedVideos && videos.length === 0) {
      setError({ message: p.noVideosChosen });
      return;
    }
    setSaving(true);
    setError(null);
    const videoIds = videos.map((v) => v.id);
    try {
      const answer = await createManagedPlaylist({
        name: title,
        title,
        titleLocalized: name.localized,
        description: about.base || undefined,
        descriptionLocalized: about.localized,
        isPublic: details.isPublic,
        visibility: detailsVisibility(details),
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
        {fixedVideos ? (
          <>
            <h3 id={`${idPrefix}-videos-label`} className={LABEL}>{p.videosInOrder}</h3>
            <SortableVideoList videos={videos} onChange={setVideos} manual={manual} removable disabled={saving} labelledBy={`${idPrefix}-videos-label`} testId="create-order" />
          </>
        ) : !channelId ? (
          // A personal playlist: videos come from Save on any video, not a channel's picker
          <p className={`text-sm ${MUTED}`} data-testid="playlist-personal-add-hint">{t.playlist.personalAddVideosHint}</p>
        ) : (
          <>
            <h3 id={`${idPrefix}-videos-label`} className={LABEL}>{p.addVideosOptional}</h3>
            <VideoPicker channelId={channelId} selected={videos} onChange={setVideos} idPrefix={`${idPrefix}-picker`} pageSize={compact ? 12 : 24} hideTray={videos.length > 0} />
            {videos.length > 0 && (
              <div className="pl-tray space-y-2 rounded-[var(--r-md)] p-3" data-testid="picker-tray">
                <div className="flex items-center justify-between gap-2">
                  <h4 id={`${idPrefix}-order-label`} className={`text-sm font-semibold ${TEXT}`}>{p.selectedHeading}</h4>
                  <button type="button" className="b b-ghost b-sm" onClick={() => setVideos([])} disabled={saving}>{p.clearSelection}</button>
                </div>
                <SortableVideoList videos={videos} onChange={setVideos} manual={manual} removable disabled={saving} labelledBy={`${idPrefix}-order-label`} testId="create-order" />
              </div>
            )}
          </>
        )}
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
            {cancelLabel ?? t.playlist.upload.cancel}
          </button>
        )}
        <button type="submit" className="b b-primary" disabled={saving} data-testid="create-playlist-submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
