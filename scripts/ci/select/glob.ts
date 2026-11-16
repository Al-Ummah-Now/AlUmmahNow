/**
 * Repo-relative path globs, no dependencies: `**` (any number of segments), `*` (within a segment),
 * `?`, `{a,b}`. Patterns are anchored at the repo root: `package.json` is only the root one, and
 * `**` + `/*.md` is every Markdown file.
 */

const cache = new Map<string, RegExp>();

function escape(ch: string): string {
  return /[.+^$()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  const source = glob;
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '*') {
      if (source[i + 1] === '*') {
        // `**/` matches zero or more whole segments; a trailing `**` matches the rest
        if (source[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const end = source.indexOf('}', i);
      if (end < 0) throw new Error(`unclosed { in glob ${glob}`);
      out += `(?:${source.slice(i + 1, end).split(',').map((alt) => [...alt].map(escape).join('')).join('|')})`;
      i = end;
    } else {
      out += escape(ch);
    }
  }
  const re = new RegExp(`^${out}$`);
  cache.set(glob, re);
  return re;
}

export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchAny(globs: readonly string[], path: string): string | undefined {
  return globs.find((g) => matchGlob(g, path));
}
