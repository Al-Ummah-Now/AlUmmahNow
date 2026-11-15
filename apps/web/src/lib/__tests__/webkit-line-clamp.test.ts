import fs from 'node:fs';
import path from 'node:path';

/**
 * WebKit aborts its web process on `-webkit-line-clamp` in these components (#1382): a libstdc++
 * assertion on an empty std::optional<size_t> in line layout, reached on the Studio Comments
 * inbox, Dashboard and Posts list. Release E2E in WebKit crashed 2–6 of 6 runs; with the clamp
 * replaced by a two-line max-height (max-h-[2lh] overflow-hidden) it passed 6 of 6.
 * Keep line-clamp out of them; the WebKit release specs (studio-comments, studio-posts) cover it.
 */
const SRC = path.join(__dirname, '../..');
const FILES = [
  'components/studio/dashboard/RecentComments.tsx',
  'components/Community/management/PostCard.tsx',
  'components/notifications/NotificationRow.tsx',
];

describe('no -webkit-line-clamp where WebKit crashes', () => {
  it.each(FILES)('%s clamps with max-height, not line-clamp', (file) => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    expect(source).not.toMatch(/line-clamp/);
    expect(source).toMatch(/max-h-\[2lh\]/);
  });
});
