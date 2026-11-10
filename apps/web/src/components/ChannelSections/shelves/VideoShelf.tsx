'use client';

import type { VideoObject } from '@al-ummah/shared-types';
import VideoCard from '@/components/videoCard';
import { Shelf } from './Shelf';

/** Videos as cards; Shorts get narrow 9:16 tiles from the theme */
export function VideoShelf({ videos, shorts = false }: { videos: VideoObject[]; shorts?: boolean }) {
  return (
    <Shelf
      items={videos}
      getKey={(video) => video.id}
      itemClassName={shorts ? 'w-44' : undefined}
      renderItem={(video) => <VideoCard {...video} />}
    />
  );
}
