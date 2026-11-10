// The native apps still generate from @al-ummah/fanous-tokens. The web packages and those themes must
// not drift: same colours per mode, same component colours, same brand colours, same player chrome.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModel } from '../../fanous-tokens/src/model.ts';
import { composeTokens, loadThemes, loadTokens, resolveTheme } from '../../fanous-tokens/src/themes.ts';
import { resolvedColors } from '../src/compile.ts';
import { BUILT_IN, THEMES_DIR, loadPackageDir } from '../scripts/load.ts';

const tokens = loadTokens();
const themes = loadThemes();

for (const id of BUILT_IN.ids) {
  test(`${id}: package matches the fanous-tokens theme`, () => {
    const { theme } = loadPackageDir(`${THEMES_DIR}/${id}`);
    const model = buildModel(composeTokens(tokens, resolveTheme(id, themes)));
    const colors = resolvedColors(theme);
    for (const mode of ['light', 'dark'] as const) {
      assert.deepEqual(colors[mode].roles, Object.fromEntries(model.themes[mode].map((c) => [c.name, c.hex])), `${mode} roles`);
      assert.deepEqual(colors[mode].parts, model.components[mode], `${mode} components`);
    }
    assert.deepEqual(theme.tokens.brand, Object.fromEntries(model.brand.map((b) => [b.name, b.value])));
    const player = JSON.parse(readFileSync(new URL(`../../fanous-tokens/themes/${id}/player.json`, import.meta.url), 'utf8')).player;
    assert.deepEqual(theme.components.player.chrome, player);
  });
}
