import fs from 'node:fs';
import path from 'node:path';
import { CUT_SELECTOR, markCut } from '../truncation-fade';

/**
 * No text-overflow: ellipsis in apps/web (#1382): WebKit's web process aborts on it with bidi
 * isolation, which every page has (<html dir>). Truncated text is clipped and fades at its end
 * edge instead (globals.css + components/TruncationFade.tsx).
 */
const SRC = path.join(__dirname, '../..');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function files(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : files(full, ext);
    return ext.test(e.name) ? [full] : [];
  });
}

describe('no ellipsis in apps/web (WebKit crash)', () => {
  it('no text-overflow: ellipsis, text-ellipsis or textOverflow ellipsis anywhere', () => {
    const bad = files(SRC, /\.(css|tsx?|mjs)$/).flatMap((f) => {
      const code = stripComments(fs.readFileSync(f, 'utf8'));
      return /text-overflow:\s*ellipsis|\btext-ellipsis\b|\boverflow-ellipsis\b|textOverflow:\s*['"]ellipsis['"]/.test(code) ? [path.relative(SRC, f)] : [];
    });
    expect(bad).toEqual([]);
  });

  it('globals.css clips every element and fades cut text at its end edge in both directions', () => {
    const css = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    expect(css).toMatch(/\*\s*\{\s*text-overflow:\s*clip\s*!important;\s*\}/);
    expect(css).toMatch(/\[data-cut\]\s*\{[^}]*mask-image:\s*linear-gradient\(to right/);
    expect(css).toMatch(/\[data-cut\]:dir\(rtl\)\s*\{[^}]*mask-image:\s*linear-gradient\(to left/);
  });

  it('every CSS truncation box is watched for the fade', () => {
    const missing = files(SRC, /\.css$/).flatMap((f) => {
      const css = stripComments(fs.readFileSync(f, 'utf8'));
      return Array.from(css.matchAll(/([^{}]+)\{[^}]*text-overflow:\s*clip[^}]*\}/g))
        .map((m) => m[1].trim())
        .filter((sel) => sel !== '*')
        .flatMap((sel) => sel.split(',').map((s) => s.trim()))
        .map((s) => s.match(/(\.[\w-]+)(?:\s*>?\s*(span))?\s*$/)?.[0]?.replace(/\s*>\s*/, ' ') ?? s)
        .filter((cls) => !CUT_SELECTOR.split(', ').some((watched) => watched.endsWith(cls.trim())))
        .map((cls) => `${path.relative(SRC, f)}: ${cls}`);
    });
    expect(missing).toEqual([]);
  });

  it('marks a box cut only while its text is wider than it', () => {
    const el = document.createElement('span');
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { value: 160, configurable: true });
    markCut(el);
    expect(el.hasAttribute('data-cut')).toBe(true);
    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });
    markCut(el);
    expect(el.hasAttribute('data-cut')).toBe(false);
  });
});
