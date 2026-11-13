'use client';

/**
 * Manage Playlists › New playlist: the create form with the video picker.
 * Once created it opens the playlist's editor (following a background add,
 * if there is one). When the videos could not be added, the playlist stays
 * and this page offers Retry and a link to it.
 */

import React, { useState } from 'react';
import Link from '@/components/common/AppLink';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { playlistName } from '@/lib/playlists/playlist-names';
import '@/theme/playlist-tools.css';
import BulkAddNotice from './BulkAddNotice';
import CreatePlaylistForm, { type CreatedPlaylist } from './CreatePlaylistForm';
import { MUTED, TEXT } from './styles';
import { managePlaylistsHref } from '@/components/PlaylistManager';

export default function NewPlaylistPage({ channelId }: { channelId: string }) {
  const { t, lang, isRTL } = useLanguage();
  const p = t.playlistTools;
  const router = useRouter();
  const [stuck, setStuck] = useState<CreatedPlaylist | null>(null);
  // A channel's Manage Playlists, or (channelId '') the user's personal ones under You
  const base = managePlaylistsHref(lang, channelId);

  const created = (result: CreatedPlaylist) => {
    const href = `${base}/${encodeURIComponent(result.playlist.id)}`;
    if (result.add?.status === 'failed' && !result.add.jobId) {
      setStuck(result);
      return;
    }
    router.push(result.add?.status === 'queued' && result.add.jobId ? `${href}?job=${encodeURIComponent(result.add.jobId)}` : href);
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className={`text-2xl font-bold ${TEXT}`}>{p.newPlaylistHeading}</h1>
        <p className={MUTED}>{p.newPlaylistHelp}</p>
      </div>
      {stuck ? (
        <div className="c space-y-4">
          <BulkAddNotice
            playlistId={stuck.playlist.id}
            playlistTitle={playlistName(stuck.playlist, lang)}
            channelId={channelId}
            outcome={{ kind: 'result', result: stuck.add! }}
            videoIds={stuck.videoIds}
            justCreated
          />
          <Link href={`${base}/${encodeURIComponent(stuck.playlist.id)}`} className="b b-primary" data-testid="open-created-playlist">
            {p.openPlaylist}
          </Link>
        </div>
      ) : (
        <div className="c">
          <CreatePlaylistForm channelId={channelId} onCreated={created} onCancel={() => router.push(base)} />
        </div>
      )}
    </div>
  );
}
