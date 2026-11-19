'use client';

import { CommunityPost } from '@al-ummah/shared-types';

interface TextPostProps {
  post: CommunityPost;
  /** Unused: text keeps its own direction (dir="auto") */
  isRTL?: boolean;
}

export default function TextPost({ post }: TextPostProps) {
  if (!post.content) return null;

  return (
    <div className="prose dark:prose-invert max-w-none">
      {/* dir="auto": the text keeps its own direction on a page in the other language (an English
          post on an Arabic page read "?…next", design audit 2026-11-19) */}
      <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words text-start" dir="auto">
        {post.content}
      </p>
    </div>
  );
}
