'use client';

import Link from '@/components/common/AppLink';
import { PlaylistCover } from '@/components/PlaylistCover';
import { pickLanguage } from '@/lib/format/pick-language';
import { playlistName } from '@/lib/playlists/playlist-names';
import { useLanguage } from '@/hooks/useLanguage';
import { Shelf } from './Shelf';
import type { SectionPlaylist } from '../sectionData';

/** Playlists as cover cards linking to the playlist page */
export function PlaylistShelf({ playlists }: { playlists: SectionPlaylist[] }) {
  const { t, locale } = useLanguage();
  const countLabel = (count: number) => t.channelSections.render.videosCount.replace('{count}', String(count));

  return (
    <Shelf
      items={playlists}
      getKey={(playlist) => playlist.id}
      renderItem={(playlist) => {
        const name = playlistName(playlist, locale);
        const count = playlist.videosCount ?? playlist.videos?.length ?? 0;
        return (
          <Link
            href={`/${locale}/playlist/${playlist.id}`}
            data-testid="section-playlist-card"
            className="group block overflow-hidden rounded-lg border border-border bg-card text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlaylistCover playlist={playlist} alt={name}>
              <span className="absolute bottom-2 end-2 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground">
                {countLabel(count)}
              </span>
            </PlaylistCover>
            <div className="p-3">
              <h3 className="line-clamp-2 font-semibold group-hover:text-brand" dir="auto">{name}</h3>
              {playlist.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" dir="auto">
                  {pickLanguage(playlist.description, locale)}
                </p>
              )}
            </div>
          </Link>
        );
      }}
    />
  );
}
