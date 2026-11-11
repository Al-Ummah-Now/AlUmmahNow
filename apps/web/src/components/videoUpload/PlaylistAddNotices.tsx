'use client';

/**
 * Friendly notices about the playlist adds of new uploads: videos whose add
 * is being retried ("we'll retry") and videos that will not be added. Never
 * the raw error: the failures are reported to the admin Errors page by
 * api-videos (with Retry) and by the reporter.
 */
import React from 'react';
import { ListVideo } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { playlistName } from '@/lib/playlists/playlist-names';
import type { PlaylistAddNotice } from '@/lib/upload/playlist-adds';
import type { PlaylistWithVideos } from '@/lib/api/playlists';

interface Props {
  notices: PlaylistAddNotice[];
  playlists: PlaylistWithVideos[];
}

export function PlaylistAddNotices({ notices, playlists }: Props) {
  const { t, lang } = useLanguage();
  if (notices.length === 0) return null;
  const s = t.playlist.upload;
  const titleOf = (id: string) => {
    const p = playlists.find((x) => x.id === id);
    return p ? playlistName(p, lang === 'ar' ? 'ar' : 'en') : t.playlist.playlist;
  };
  const text = (n: PlaylistAddNotice) => {
    const template = n.kind === 'retrying' ? (n.count === 1 ? s.willRetryOne : s.willRetry) : n.count === 1 ? s.notAddedOne : s.notAdded;
    return template.replace('{count}', String(n.count)).replace('{title}', titleOf(n.playlistId));
  };
  return (
    <div className="mb-6 space-y-2" data-testid="playlist-add-notices">
      {notices.map((n) => (
        <p
          key={`${n.playlistId}-${n.kind}`}
          role="status"
          data-testid="playlist-add-notice"
          data-kind={n.kind}
          className="flex items-start gap-2 rounded-lg border border-[var(--fanous-color-accent)] bg-[var(--fanous-color-surface-raised)] p-3 text-sm text-[var(--fanous-color-text-primary)]"
        >
          <ListVideo className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fanous-color-accent)]" aria-hidden="true" />
          <span>{text(n)}</span>
        </p>
      ))}
    </div>
  );
}
