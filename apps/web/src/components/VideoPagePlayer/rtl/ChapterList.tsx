/**
 * RTL Wrapper for ChapterList Component
 *
 * This is a thin wrapper that ensures proper RTL styling
 * for Arabic language support.
 */

import { ChapterList as BaseChapterList } from '../ChapterList';

export function ChapterList(props: Parameters<typeof BaseChapterList>[0]) {
  return (
    <div dir="rtl">
      <BaseChapterList {...props} />
    </div>
  );
}

export default ChapterList;
