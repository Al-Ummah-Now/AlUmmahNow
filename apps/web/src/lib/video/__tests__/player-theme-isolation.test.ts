/**
 * The site theme (src/theme, globals.css) skins the site's own menus and dialogs; the player's
 * menus are skinned by player-skin.css from the player theme tokens. A generic site rule such as
 * `[role=menu]{background:...!important}` matching the player's settings panel turned it into a
 * cream card with the player's light value text and chevrons on it (unreadable, and the
 * Firefox alignment specs could no longer find their ink). No site rule may match the player's
 * menus except the universal resets.
 */
import fs from 'fs';
import path from 'path';

const src = path.join(__dirname, '../../..');
const siteCss = [
  'app/globals.css',
  ...['theme'].flatMap((dir) =>
    fs.readdirSync(path.join(src, dir)).filter((f) => f.endsWith('.css')).map((f) => `${dir}/${f}`),
  ),
];

/** Selectors of every innermost rule (at-rule bodies included), split on top-level commas */
function selectors(css: string): string[] {
  const out: string[] = [];
  const ruleRe = /([^{}]+)\{[^{}]*\}/g;
  let match: RegExpExecArray | null;
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  while ((match = ruleRe.exec(plain)) !== null) {
    out.push(...match[1].split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

// Not element selectors, or not something jsdom can evaluate. `:has()` rules in the theme are
// all anchored on page content (main, comments, upload), never on a portalled player layer.
const unmatchable = /^(from|to|[\d.]+%|@.*)$|:has\(|::(backdrop|file-selector-button)$/;

const playerMenus = `
  <div class="video-js vjs-fanous">
    <div class="vjs-menu"><ul class="vjs-menu-content" role="menu"><li class="vjs-menu-item" role="menuitemradio">720p</li></ul></div>
  </div>
  <div class="vjs-fanous-layer vjs-fanous-menu" data-player-layer="" role="menu" dir="ltr" data-testid="player-settings-menu">
    <div class="vjs-fanous-menu-view">
      <button type="button" role="menuitem" class="vjs-fanous-mi" data-row="speed">
        <span class="vjs-fanous-mi-icon"><svg viewBox="0 0 24 24"></svg></span>
        <span class="vjs-fanous-mi-label">Speed</span>
        <span class="vjs-fanous-mi-value">Normal</span>
        <span class="vjs-fanous-mi-end"><svg viewBox="0 0 24 24"></svg></span>
      </button>
    </div>
  </div>`;

describe('site theme CSS leaves the player menus to the player skin', () => {
  beforeEach(() => {
    document.body.innerHTML = playerMenus;
  });

  it.each(siteCss)('%s has no rule matching a player menu', (file) => {
    const els = Array.from(document.querySelectorAll('.vjs-menu-content, .vjs-menu-content *, .vjs-fanous-layer, .vjs-fanous-layer *'));
    expect(els.length).toBeGreaterThan(8);
    const leaks: string[] = [];
    for (const sel of selectors(fs.readFileSync(path.join(src, file), 'utf8'))) {
      if (sel === '*' || unmatchable.test(sel)) continue;
      // Anything else must parse: a selector jsdom rejects would slip past this check unseen
      if (els.some((el) => el.matches(sel))) leaks.push(sel);
    }
    expect(leaks).toEqual([]);
  });

  it('still skins the site menus with the same rules', () => {
    document.body.innerHTML += '<div role="menu" id="site-menu"></div>';
    const site = document.getElementById('site-menu')!;
    const system = selectors(fs.readFileSync(path.join(src, 'theme/system.css'), 'utf8'));
    const bridge = selectors(fs.readFileSync(path.join(src, 'theme/bridge.css'), 'utf8'));
    expect(system.some((sel) => sel.startsWith('[role=menu]') && site.matches(sel))).toBe(true);
    expect(bridge.some((sel) => sel.startsWith('[role=menu]') && site.matches(sel))).toBe(true);
  });
});
