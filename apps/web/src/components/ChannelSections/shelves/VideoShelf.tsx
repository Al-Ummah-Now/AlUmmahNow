'use client';

import type { VideoObject } from '@al-ummah/shared-types';
import VideoCard from '@/components/videoCard';
import { leadingImageLoading } from '@/components/VideoThumbnail/leading';
import { Shelf } from './Shelf';

/**
 * Videos as cards; Shorts get narrow 9:16 tiles from the theme. `leading`: the page's first shelf,
 * whose first thumbnails load at once (leadingImageLoading).
 */
export function VideoShelf({ videos, shorts = false, leading = false }: { videos: VideoObject[]; shorts?: boolean; leading?: boolean }) {
  return (
    <Shelf
      items={videos}
      getKey={(video) => video.id}
      itemClassName={shorts ? 'w-44' : undefined}
      renderItem={(video, index) => <VideoCard {...video} imageLoading={leadingImageLoading(index, leading)} />}
    />
  );
}
