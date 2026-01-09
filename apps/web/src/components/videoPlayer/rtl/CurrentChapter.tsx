/**
 * RTL Wrapper for CurrentChapter Component
 *
 * This is a thin wrapper that ensures proper RTL styling
 * for Arabic language support.
 */

import { CurrentChapter as BaseCurrentChapter } from '../CurrentChapter';

export function CurrentChapter(props: Parameters<typeof BaseCurrentChapter>[0]) {
  return (
    <div dir="rtl">
      <BaseCurrentChapter {...props} />
    </div>
  );
}

export default CurrentChapter;
