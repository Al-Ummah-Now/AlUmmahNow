import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlayer, loadPlayerThemes, PLAYER_SHARED_TOKENS, PLAYER_TOKENS, playerCss, validatePlayerTheme } from '../src/player.ts';

const full = Object.fromEntries(PLAYER_TOKENS.map((n) => [n, '#000000']));

test('the four themes define every player token and nothing else', () => {
  const themes = loadPlayerThemes();
  assert.deepEqual(Object.keys(themes), ['fawanees', 'lantern', 'nahas', 'zujaj']);
  for (const [id, tokens] of Object.entries(themes)) assert.deepEqual(validatePlayerTheme(id, tokens), [], id);
});

test('a missing token is reported with its theme', () => {
  const { bar: _bar, ...rest } = full;
  assert.deepEqual(validatePlayerTheme('ramadan', rest), ['ramadan: player.bar is missing']);
});

test('an unknown token is reported', () => {
  assert.deepEqual(validatePlayerTheme('x', { ...full, sparkle: 'red' }), ['x: player.sparkle is not a player token']);
});

test('a value that could break out of the declaration is refused', () => {
  const errors = validatePlayerTheme('x', { ...full, icon: 'red; } body { display: none' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /player\.icon must be a single CSS value/);
  assert.equal(validatePlayerTheme('x', { ...full, big: 'url(https://example.com/a.png)' }).length, 1);
});

test('the CSS names every token once, in contract order', () => {
  const css = playerCss('lantern', full);
  for (const n of PLAYER_TOKENS) assert.equal(css.split(`--fanous-player-${n}:`).length, 2, n);
  assert.match(css, /^\/\* Generated/);
});

test('lantern is required', () => {
  assert.deepEqual(generatePlayer({ zujaj: full }).errors, ['lantern: themes/lantern/player.json is required (the default theme)']);
});

test('every theme carries the shared layer level, above the header, consent banner and full-window player', () => {
  for (const id of ['lantern', 'zujaj']) assert.match(playerCss(id, full), /--fanous-player-layer: 1100;/);
  assert.ok(Number(PLAYER_SHARED_TOKENS.layer) > 1000);
  assert.deepEqual(validatePlayerTheme('x', { ...full, layer: '5' }), ['x: player.layer is not a player token']);
});
