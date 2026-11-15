import fs from 'node:fs';
import path from 'node:path';

/**
 * WebKit's web process aborts (libstdc++ assertion on an empty std::optional<size_t> while
 * rendering) when text-overflow: ellipsis meets bidi isolation: <bdi>, or an element with dir
 * (#1382: Studio Comments, Dashboard and Posts crashed 2–6 of 6 WebKit release runs; with either
 * the ellipsis or the isolation turned off they passed 8 of 8). globals.css swaps the ellipsis for
 * an end-edge fade wherever `truncate` meets an isolate; this keeps that rule in place.
 */
const css = fs.readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8');

describe('truncate never ellipsises bidi-isolated text (WebKit crash)', () => {
  it('isolates that truncate, and truncate boxes holding one, clip and fade instead', () => {
    const start = css.indexOf(':is(bdi, [dir]).truncate,');
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('.truncate:has(bdi, [dir])');
    expect(rule).toMatch(/text-overflow: clip/);
    expect(rule).toMatch(/mask-image: linear-gradient\(to right/);
  });

  it('fades toward the end edge in right-to-left text', () => {
    const rtl = css.slice(css.indexOf(':is(bdi, [dir]).truncate:dir(rtl)'));
    expect(rtl).toMatch(/^:is\(bdi, \[dir\]\)\.truncate:dir\(rtl\),\s*\.truncate:has\(bdi, \[dir\]\):dir\(rtl\) \{[^}]*to left/);
  });

  it('the line clamp utility stays free of -webkit-line-clamp', () => {
    const rule = css.slice(css.indexOf('.clamp-2 {'), css.indexOf('.clamp-2:dir(rtl)'));
    expect(rule).not.toMatch(/line-clamp:|-webkit-box/);
  });
});
