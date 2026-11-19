'use client';

import { CommunityPost } from '@al-ummah/shared-types';
import Image from 'next/image';

interface GifPostProps {
  post: CommunityPost;
  /** Unused: text keeps its own direction (dir="auto") */
  isRTL?: boolean;
}

export default function GifPost({ post }: GifPostProps) {
  if (!post.gif) return null;

  return (
    <div className="space-y-3">
      {/* Text content */}
      {post.content && (
        <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words text-start" dir="auto">
          {post.content}
        </p>
      )}

      {/* GIF */}
      <div className="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
        <div className="relative w-full" style={{ paddingBottom: `${(post.gif.height / post.gif.width) * 100}%` }}>
          <Image
            src={post.gif.url}
            alt="Animated GIF"
            fill
            className="object-contain"
            unoptimized
          />
        </div>
        {/* GIF badge */}
        <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-bold px-2 py-1 rounded">
          GIF
        </div>
      </div>
    </div>
  );
}
