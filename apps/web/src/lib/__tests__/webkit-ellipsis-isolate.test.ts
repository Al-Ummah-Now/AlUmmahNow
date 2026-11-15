import fs from 'node:fs';
import path from 'node:path';

/**
 * WebKit's web process aborts (libstdc++ assertion on an empty std::optional<size_t> during
 * rendering) when a line cut with text-overflow: ellipsis holds an inline bidi isolate: <bdi>, or
 * an inline element with dir (#1382: Studio Comments' "On {title}" line, 2–6 of 6 WebKit runs).
 * With either the ellipsis or the isolate removed the release job passed 8 of 8. The isolate must
 * be the box that truncates (OnTitle, or <bdi className="block truncate">), never an inline child
 * of a `truncate` element.
 */
const SRC = path.join(__dirname, '../..');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(full);
    return /\.tsx$/.test(e.name) ? [full] : [];
  });
}

/** `truncate` elements whose content (up to their closing tag) holds an inline <bdi> or dir span */
function offenders(source: string): string[] {
  const found: string[] = [];
  const open = /<(p|h[1-6]|span|div|li|a|Link|label|dd|dt|td)\b[^>]*className=(?:"[^"]*\btruncate\b[^"]*"|\{`[^`]*\btruncate\b[^`]*`\})[^>]*>/g;
  for (const m of source.matchAll(open)) {
    const tag = m[1];
    const rest = source.slice(m.index! + m[0].length);
    const end = rest.indexOf(`</${tag}>`);
    const body = end === -1 ? '' : rest.slice(0, end);
    for (const child of body.matchAll(/<(bdi|span)\b([^>]*)>/g)) {
      const attrs = child[2];
      const isolate = child[1] === 'bdi' || /\bdir=/.test(attrs);
      const isBox = /\b(block|truncate|flex|inline-block)\b/.test(attrs);
      if (isolate && !isBox) found.push(`${m[0].slice(0, 80)} … <${child[1]}${attrs.slice(0, 40)}>`);
    }
  }
  return found;
}

describe('no ellipsis line around an inline bidi isolate (WebKit crash)', () => {
  it('flags the pattern that crashed', () => {
    expect(offenders('<p className="truncate text-xs">On <bdi>{t}</bdi></p>')).toHaveLength(1);
    expect(offenders('<p className="truncate"><span dir="auto">{t}</span></p>')).toHaveLength(1);
    expect(offenders('<p className="text-xs"><bdi className="block truncate">{t}</bdi></p>')).toHaveLength(0);
  });

  it('no component has it', () => {
    const bad = files(SRC).flatMap((f) => offenders(fs.readFileSync(f, 'utf8')).map((o) => `${path.relative(SRC, f)}: ${o}`));
    expect(bad).toEqual([]);
  });
});
