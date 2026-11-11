'use client';

import { CommunityPost } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import Link from '@/components/common/AppLink';

interface VideoPostProps {
  post: CommunityPost;
  isRTL?: boolean;
}

export default function VideoPost({ post, isRTL = false }: VideoPostProps) {
  if (!post.videoId) return null;

  return (
    <div className="space-y-3">
      {/* Text content */}
      {post.content && (
        <p className={cn(
          'text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words',
          isRTL && 'text-right'
        )}>
          {post.content}
        </p>
      )}

      {/* Video Link Card */}
      <Link
        href={`/videos/${post.videoId}`}
        className="block border-2 border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-blue-500 dark:hover:border-blue-400 transition-colors group"
      >
        <div className="relative aspect-video bg-gray-100 dark:bg-gray-800">
          {/* Video thumbnail would go here */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
            </div>
          </div>
        </div>
        <div className={cn(
          'p-4 bg-white dark:bg-gray-800',
          isRTL && 'text-right'
        )}>
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
            </svg>
            <span className="font-medium">
              {isRTL ? 'مشاهدة الفيديو' : 'Watch Video'}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
