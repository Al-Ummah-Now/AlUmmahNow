'use client';

import { CommunityPost } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';

interface TextPostProps {
  post: CommunityPost;
  isRTL?: boolean;
}

export default function TextPost({ post, isRTL = false }: TextPostProps) {
  if (!post.content) return null;

  return (
    <div className={cn(
      'prose dark:prose-invert max-w-none',
      isRTL && 'text-right'
    )}>
      <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
        {post.content}
      </p>
    </div>
  );
}
