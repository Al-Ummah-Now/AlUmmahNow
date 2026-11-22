import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The error-page family's card (errors/aun-error-page.css, wiki guides/error-pages.md): used as is by
 * the videos site and admin, vendored by UI and the CMS. It must restyle with every theme and mode,
 * never animate, and keep a readable card without backdrop-filter.
 */
const css = readFileSync(new URL('../errors/aun-error-page.css', import.meta.url), 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('no animation or transition (reduced motion by default)', () => {
  assert.doesNotMatch(rules, /@keyframes|animation\s*:|transition\s*:/);
});

test('colours come from tokens: only the documented fallbacks are literal', () => {
  const literals = rules.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [];
  assert.deepEqual(literals, ['#e8b477']);
  for (const v of rules.match(/var\(--[a-z0-9-]+/g) ?? []) {
    assert.match(v, /^var\(--(fanous-|aun-|ep-)/, v);
  }
});

test('a near-opaque card without blur support or with reduced transparency', () => {
  assert.match(rules, /@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.ep-card\{background:var\(--fanous-color-surface\)\}\}/);
  assert.match(rules, /prefers-reduced-transparency:reduce\)\{\.ep-card\{background:var\(--fanous-color-surface\)\}\}/);
});

test('logical properties only (one sheet for English and Arabic)', () => {
  assert.doesNotMatch(rules, /(margin|padding|border)-(left|right)\b|\b(left|right)\s*:|text-align:(left|right)/);
});

test('the card has its own buttons (UNIFY): one gold, height and shape in every app', () => {
  assert.match(rules, /\.ep \.ep-btn\{[^}]*min-height:44px[^}]*border-radius:999px[^}]*font-family:inherit/);
  assert.match(rules, /\.ep \.ep-btn-primary\{background:var\(--fanous-c-button-primary-bg,var\(--fanous-color-primary\)\)/);
  assert.match(rules, /\.ep \.ep-btn-secondary\{background:transparent;[^}]*border:1px solid var\(--fanous-c-button-secondary-border/);
});

test('titles take the page font and bodies wrap in balanced lines (no lone last word)', () => {
  assert.match(rules, /\.ep-title\{[^}]*font-family:inherit[^}]*text-wrap:balance/);
  assert.match(rules, /\.ep-body\{[^}]*text-wrap:balance/);
});

test('the videos site and admin use this file itself, not a copy', () => {
  const web = readFileSync(new URL('../../../apps/web/src/components/errors/ErrorScreen.tsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../../apps/admin-web/src/app/globals.css', import.meta.url), 'utf8');
  assert.match(web, /packages\/fanous-tokens\/errors\/aun-error-page\.css/);
  assert.match(admin, /packages\/fanous-tokens\/errors\/aun-error-page\.css/);
});
