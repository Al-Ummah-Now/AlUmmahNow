import fs from 'node:fs';
import path from 'node:path';

/**
 * WebKit aborts its web process on `-webkit-line-clamp` in these components (#1382): a libstdc++
 * assertion on an empty std::optional<size_t> in line layout, reached on the Studio Comments
 * inbox, Dashboard and Posts list. Release E2E in WebKit crashed 2–6 of 6 runs; with the clamp
 * replaced by a two-line max-height it passed 6 of 6. They use .clamp-2 (globals.css: max-height 2lh,
 * the last line fading toward its end edge).
 * Keep line-clamp out of them; the WebKit release specs (studio-comments, studio-posts) cover it.
 */
const SRC = path.join(__dirname, '../..');
const FILES = [
  'components/studio/dashboard/RecentComments.tsx',
  'components/Community/management/PostCard.tsx',
  'components/notifications/NotificationRow.tsx',
];

describe('no -webkit-line-clamp where WebKit crashes', () => {
  it.each(FILES)('%s clamps with .clamp-2, not line-clamp', (file) => {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    expect(source).not.toMatch(/line-clamp/);
    expect(source).toMatch(/\bclamp-2\b/);
  });

  it('.clamp-2 has no line-clamp and fades at the end edge in both directions', () => {
    const css = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    const rule = css.slice(css.indexOf('.clamp-2 {'), css.indexOf('.clamp-2:dir(rtl)') + 200);
    expect(rule).not.toMatch(/line-clamp:|-webkit-box/);
    expect(rule).toMatch(/max-height: 2lh/);
    expect(rule).toMatch(/to right/);
    expect(rule).toMatch(/:dir\(rtl\)[\s\S]*to left/);
  });
});
