'use client';

/**
 * One batch row's playlists: the batch's (shown, with "Choose for this video")
 * or the row's own picker (with "Use the batch playlists"). Locked once the
 * row's adds were requested.
 */
import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { PlaylistPicker } from './PlaylistPicker';
import type { PlaylistWithVideos } from '@/lib/api/playlists';
import type { NewPlaylistInput } from '@/lib/api/upload-playlists-client';

interface Props {
  rowId: string;
  playlists: PlaylistWithVideos[];
  loading: boolean;
  failed: boolean;
  batch: string[];
  override: string[] | undefined;
  /** Playlists the adds were requested for (locked) */
  committed?: string[];
  onOverride: (ids: string[] | undefined) => void;
  onCreate: (input: NewPlaylistInput) => Promise<PlaylistWithVideos | null>;
}

const linkButton = 'text-xs font-medium text-[var(--fanous-color-link)] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)] rounded';

export function BatchRowPlaylists({ rowId, playlists, loading, failed, batch, override, committed, onOverride, onCreate }: Props) {
  const { t } = useLanguage();
  const s = t.playlist.upload;
  const own = override !== undefined;
  const shown = committed ?? override ?? batch;
  return (
    <div className="space-y-1.5" data-testid="batch-row-playlists" data-mode={committed ? 'locked' : own ? 'own' : 'batch'}>
      <PlaylistPicker
        id={`batch-playlists-${rowId}`}
        testId="batch-row-playlist-picker"
        compact
        label={own || committed ? s.rowLabel : `${s.rowLabel} · ${s.sameAsBatch}`}
        playlists={playlists}
        loading={loading}
        failed={failed}
        selected={shown}
        onChange={(ids) => onOverride(ids)}
        onCreate={onCreate}
        locked={!!committed}
        readOnly={!committed && !own}
      />
      {!committed && (
        <button type="button" className={linkButton} onClick={() => onOverride(own ? undefined : [...batch])} data-testid="batch-row-playlists-mode">
          {own ? s.useBatch : s.customize}
        </button>
      )}
    </div>
  );
}
