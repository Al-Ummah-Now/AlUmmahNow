import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrastRatio } from '../src/contrast.ts';

/**
 * The account menu's separators and border must show in every theme and mode, in every app that
 * vendors nav/aun-nav.css (videos web + admin, www, CMS, profile, auth admin). Owner review rev 4:
 * "in dark you can't see the lines between rows", then the same report for the CMS menu.
 * Reads the real --aun-menu-line / --aun-menu-edge rules and the generated theme tokens.
 */
const THEMES = ['lantern', 'fawanees', 'zujaj', 'nahas'];
const SEPARATOR_FLOOR = 2.4;
const EDGE_FLOOR = 3;

const css = readFileSync(new URL('../nav/aun-nav.css', import.meta.url), 'utf8');

function rule(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `--${name} is defined`);
  return m[1];
}

/** Splits light-dark(a, b) at its top-level comma. */
function lightDark(value: string): [string, string] {
  const inner = value.trim().replace(/^light-dark\(/, '').replace(/\)$/, '');
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  throw new Error(`not light-dark(): ${value}`);
}

function block(tokens: string, mode: 'light' | 'dark'): Record<string, string> {
  const start = tokens.indexOf(`[data-fanous-theme='${mode}']`);
  assert.ok(start >= 0, `${mode} block`);
  const body = tokens.slice(start, tokens.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--fanous-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Resolves var(--fanous-x) or color-mix(in srgb, var(--a) N%, var(--b)) against a token block. */
function resolve(expr: string, t: Record<string, string>): string {
  const v = (s: string) => {
    const name = s.match(/var\(--fanous-([\w-]+)\)/)?.[1];
    assert.ok(name && t[name], `token for ${s}`);
    return t[name];
  };
  const mix = expr.match(/^color-mix\(in srgb,\s*(var\([^)]+\))\s+(\d+)%,\s*(var\([^)]+\))\)$/);
  if (!mix) return v(expr);
  const p = Number(mix[2]) / 100;
  const a = rgb(v(mix[1]));
  const b = rgb(v(mix[3]));
  return toHex(a.map((x, i) => x * p + b[i] * (1 - p)));
}

for (const theme of THEMES) {
  const tokens = readFileSync(new URL(`../generated/${theme}/web/tokens.css`, import.meta.url), 'utf8');
  for (const [i, mode] of (['light', 'dark'] as const).entries()) {
    test(`${theme} ${mode}: menu separators and border show`, () => {
      const t = block(tokens, mode);
      const bg = resolve(lightDark(rule('aun-menu-bg'))[i], t);
      const line = resolve(lightDark(rule('aun-menu-line'))[i], t);
      const edge = resolve(lightDark(rule('aun-menu-edge'))[i], t);
      const sep = contrastRatio(line, bg);
      assert.ok(sep >= SEPARATOR_FLOOR, `separator ${line} on ${bg}: ${sep.toFixed(2)}:1 < ${SEPARATOR_FLOOR}`);
      const border = contrastRatio(edge, bg);
      assert.ok(border >= EDGE_FLOOR, `border ${edge} on ${bg}: ${border.toFixed(2)}:1 < ${EDGE_FLOOR}`);
    });
  }
}

// A minifier in a vendoring app (the CMS) drops the space in "a :is(b)", turning a descendant
// selector into a compound one (it then matches nothing): write the element selector out instead
test('no descendant combinator directly before a pseudo-class function', () => {
  const bad = css.split('\n').filter((line) => /[^,{;(\s]\s+:(is|where|has|not)\(/.test(line) && !line.trim().startsWith('/*') && !line.trim().startsWith('*'));
  assert.deepEqual(bad, []);
});

// Every page loads this stylesheet before it renders: the app icons are separate files
// (nav/icons/<id>.webp, served at /aun-nav/icons/), never inlined, and nothing else is fetched
test('the stylesheet inlines no images and fetches nothing', () => {
  assert.doesNotMatch(css, /url\(|@import|data:/);
  assert.ok(css.length < 32_000, `aun-nav.css is ${css.length} bytes`);
});
