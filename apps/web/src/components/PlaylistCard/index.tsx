'use client';

import { playlistDescription, playlistName } from '@/lib/playlists/playlist-names';
import React from 'react';
import { PlaylistCover } from '@/components/PlaylistCover';
import { Playlist } from '@al-ummah/shared-types';
import { formatVideoCount } from '@/lib/format/videoMeta';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlayAllEntryHref, getPlaylistDisplayName, getPlaylistVideoCount } from '@/lib/playlists/playlist-utils';
import { PlayAllOverlay } from '@/components/PlaylistCover/PlayAllOverlay';
import { RelativeDate } from '@/components/RelativeDate';
import { PlaylistCardFrame } from './PlaylistCardFrame';

export function PlaylistCard(playlist: Playlist) {
  const { lang, t } = useLanguage();
  // Channel playlist listings return `title` + `videos` without the `name` / `videosCount` aliases
  // The viewer's language (lib/playlists/playlist-names.ts)
  const name = playlistName({ ...playlist, name: getPlaylistDisplayName(playlist as Playlist & { title?: string }) }, lang);
  const count = getPlaylistVideoCount(playlist as Playlist & { videos?: unknown });

  return (
    <PlaylistCardFrame
      href={`/${lang}/playlist/${playlist.id}`}
      testId="playlist-card"
      title={name}
      countLabel={formatVideoCount(count, lang, { compact: true })}
      cover={(overlay) => (
        <PlaylistCover playlist={playlist} alt={name}>
          {overlay}
        </PlaylistCover>
      )}
      meta={
        <>
          {playlist.description && (
            <p dir="auto" className="plc-meta">
              {playlistDescription(playlist, lang)}
            </p>
          )}
          <p className="plc-meta">
            {/* Its last change (created counts as the first): «حُدّث قبل …» / "Updated …" */}
            <RelativeDate value={(playlist as { dateModified?: string }).dateModified || playlist.dateCreated} lang={lang} label="updated" />
          </p>
        </>
      }
      action={count > 0 ? <PlayAllOverlay href={getPlayAllEntryHref(lang, playlist.id)} label={t.playlist.playAll} /> : undefined}
    />
  );
}
