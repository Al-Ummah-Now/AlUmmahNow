'use client';

import { splitQafQuotes, type CommunityPost } from '@al-ummah/shared-types';

import QafQuotation from './QafQuotation';

interface TextPostProps {
  post: CommunityPost;
  /** Unused: text keeps its own direction (dir="auto") */
  isRTL?: boolean;
}

export default function TextPost({ post }: TextPostProps) {
  if (!post.content) return null;

  return (
    <div className="prose dark:prose-invert max-w-none">
      {splitQafQuotes(post.content).map(({ source, quote }, index) => quote
        ? <QafQuotation key={index} quote={quote} />
        : <p key={index} className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words text-start" dir="auto">{source}</p>)}
    </div>
  );
}
