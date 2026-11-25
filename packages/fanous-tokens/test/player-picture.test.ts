/** Nothing of the player's chrome lights or tints the picture (docs/design/player-themes.md). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../themes/', import.meta.url);
const themes = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map(({ name }) => ({ name, player: JSON.parse(readFileSync(new URL(`${name}/player.json`, dir), 'utf8')).player as Record<string, string> }));
/** Each shadow of a list: its blur radius, whether it is inset, and its colour when written rgb() or hex */
const shadows = (value: string) => (value === 'none' ? [] : value.split(/,(?![^(]*\))/).map((s) => {
  const colour = /rgb\((\d+) (\d+) (\d+)/.exec(s)?.slice(1).map(Number) ?? [...(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(s)?.slice(1) ?? [])].map((h) => parseInt(h, 16));
  const lengths = s.replace(/rgb\([^)]*\)|#[0-9a-f]+/g, '').match(/-?[\d.]+(px)?/g) ?? [];
  return { inset: s.includes('inset'), blur: parseFloat(lengths[2] ?? '0'), bright: colour.length === 3 && Math.max(...colour) > 90 };
}));

describe('the picture under the player', () => {
  it('covers every theme', () => assert.deepEqual(themes.map((t) => t.name).sort(), ['fawanees', 'lantern', 'nahas', 'zujaj']));
  for (const { name, player } of themes) {
    it(`${name}: no light falls on it`, () => {
      for (const token of ['glow', 'handle-edge', 'big-edge', 'bar-edge']) {
        for (const s of shadows(player[token]!)) assert.ok(s.inset || s.blur < 8 || !s.bright, `${token}: ${player[token]}`);
      }
    });
    it(`${name}: a bar that fades into it is neutral`, () => {
      if (player['bar-inset'] !== '0' || !/transparent\)$/.test(player.bar!)) return; // a panel of its own
      assert.ok(!player.bar!.includes('radial-gradient'), player.bar);
      for (const m of player.bar!.matchAll(/rgb\((\d+) (\d+) (\d+)/g)) assert.ok(m[1] === m[2] && m[2] === m[3], player.bar);
    });
  }
});
