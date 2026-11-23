import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The error-page family's card (errors/aun-error-page.css, wiki guides/error-pages.md): used as is by
 * the videos site and admin, vendored by UI, Auth and the CMS. It must restyle with every theme and mode,
 * never animate, and be one solid card colour in every app.
 */
const css = readFileSync(new URL('../errors/aun-error-page.css', import.meta.url), 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('no animation or transition (reduced motion by default)', () => {
  assert.doesNotMatch(rules, /@keyframes|animation\s*:|transition\s*:/);
});

test('colours come from tokens: only the documented fallbacks are literal', () => {
  // rgb(from …) works a colour out of a token (the card); only a literal rgb()/hsl() is a hard-coded colour
  const literals = rules.match(/#[0-9a-f]{3,8}\b|rgba?\((?!from )|hsla?\(/gi) ?? [];
  assert.deepEqual(literals, ['#e8b477']);
  for (const v of rules.match(/var\(--[a-z0-9-]+/g) ?? []) {
    assert.match(v, /^var\(--(fanous-|aun-|ep-)/, v);
  }
});

test('one solid card (owner, 2026-11-22): no blur, no see-through surface, the same colour in every app', () => {
  assert.doesNotMatch(rules, /backdrop-filter|transparent\)\);?\s*--ep-edge|aun-glass-surface/);
  // Worked out from the page colour, so it does not depend on an app's mode selector or glass tokens
  assert.match(rules, /--ep-surface:var\(--fanous-color-surface\)/);
  assert.match(rules, /@supports \(color:rgb\(from red r g b\)\)\{\.ep\{--ep-surface:rgb\(from var\(--fanous-color-background\) /);
  assert.match(rules, /\.ep-card\{[^}]*background:var\(--ep-surface\)/);
});

test('the help line and the actions share one row on wide screens in every language', () => {
  assert.match(rules, /\.ep-foot\{display:flex;flex-wrap:nowrap/);
  assert.match(rules, /\.ep-help\{flex:1 1 0;min-width:0;[^}]*text-wrap:balance/);
  assert.match(rules, /\.ep-actions\{display:flex;flex:none;flex-wrap:nowrap/);
  assert.match(rules, /\.ep-ref-hint\{[^}]*text-wrap:balance/);
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
  // each sentence is an inline block: a line never ends on the next sentence's first words
  assert.match(rules, /\.ep-s\{display:inline-block\}/);
});

test('the videos site and admin use this file itself, not a copy', () => {
  const web = readFileSync(new URL('../../../apps/web/src/components/errors/ErrorScreen.tsx', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../../../apps/admin-web/src/app/globals.css', import.meta.url), 'utf8');
  assert.match(web, /packages\/fanous-tokens\/errors\/aun-error-page\.css/);
  assert.match(admin, /packages\/fanous-tokens\/errors\/aun-error-page\.css/);
});
