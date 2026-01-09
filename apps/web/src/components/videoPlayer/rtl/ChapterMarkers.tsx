/**
 * RTL Wrapper for ChapterMarkers Component
 *
 * This is a thin wrapper that ensures proper RTL styling
 * for Arabic language support.
 */

import { ChapterMarkers as BaseChapterMarkers } from '../ChapterMarkers';

export function ChapterMarkers(props: Parameters<typeof BaseChapterMarkers>[0]) {
  return (
    <div dir="rtl">
      <BaseChapterMarkers {...props} />
    </div>
  );
}

export default ChapterMarkers;
