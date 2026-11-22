'use client';

import React from 'react';
import { ListVideo } from 'lucide-react';
import VideoThumbnail, { THUMBNAIL_16_9, type ImageLoading } from '@/components/VideoThumbnail';
import { getPlaylistCoverUrl, type PlaylistCoverFields } from '@/lib/playlists/playlist-utils';

interface PlaylistCoverProps {
  playlist: PlaylistCoverFields;
  /** Loaded videos, when the caller has them: the last fallback for the cover */
  videos?: Array<{ thumbnailUrl?: string | null }>;
  alt: string;
  sizes?: string;
  className?: string;
  /** Overlays such as the video count badge */
  children?: React.ReactNode;
  /** `high` when the cover is the page's largest image (the playlist page) */
  loading?: ImageLoading;
}

/** Shown for empty playlists and when the cover image cannot be loaded. */
function PlaylistCoverPlaceholder() {
  return (
    <div
      // Tinted toward the theme colour: the plain surface was the card's own colour, so an empty
      // cover vanished on light cards (AUDIT-2)
      className="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--fanous-color-primary)_12%,var(--fanous-color-surface))]"
      data-testid="playlist-cover-placeholder"
    >
      <ListVideo className="h-1/3 w-1/3 max-h-12 max-w-12 text-[var(--fanous-color-text-muted)]" aria-hidden="true" />
    </div>
  );
}

/**
 * The one way to render a playlist cover. Direction-neutral: LTR and RTL
 * surfaces share it, and callers position overlays with logical utilities.
 */
export function PlaylistCover({ playlist, videos, alt, sizes, className, children, loading }: PlaylistCoverProps) {
  return (
    <VideoThumbnail
      src={getPlaylistCoverUrl(playlist, videos)}
      alt={alt}
      sizes={sizes}
      className={className}
      style={THUMBNAIL_16_9}
      placeholder={<PlaylistCoverPlaceholder />}
      loading={loading}
    >
      {children}
    </VideoThumbnail>
  );
}
