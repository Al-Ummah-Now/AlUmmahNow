/**
 * Regression: the quality button did not open its menu (production and QA).
 *
 * Clicking it added `vjs-lock-showing`, but nothing was painted:
 *  1. Video.js styles `.vjs-menu-button-popup .vjs-menu` as `height: 0` and
 *     hangs an absolutely positioned list above it. Our CSS makes the list
 *     static and the menu box scrollable, but never reset the height, so the
 *     0px box clipped the whole list.
 *  2. `.vjs-control-bar` had `contain: ... paint`, which clips descendants to
 *     the 64px bar - the menu opens above the bar, so it was clipped again.
 *
 * jsdom does no layout, so these tests pin the CSS contract.
 */
import fs from 'fs';
import path from 'path';

const playerCss = fs.readFileSync(path.join(__dirname, '../../../styles/video-player.css'), 'utf8');

/** Declarations of every rule whose selector list contains `selector` */
function declarationsFor(selector: string): string[] {
  const rules: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(playerCss)) !== null) {
    const selectors = match[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) rules.push(match[2].replace(/\/\*[\s\S]*?\*\//g, ''));
  }
  return rules;
}

describe('quality menu CSS', () => {
  it('lets the popup menu box size to its (static) list instead of Video.js height: 0', () => {
    const menuRules = declarationsFor('.video-js .vjs-menu-button-popup .vjs-menu').join('\n');
    expect(menuRules).toMatch(/position:\s*absolute/);
    expect(menuRules).toMatch(/height:\s*auto\s*!important/);
    expect(menuRules).toMatch(/margin-bottom:\s*0\s*!important/);

    const listRules = declarationsFor('.video-js .vjs-menu-button-popup .vjs-menu .vjs-menu-content').join('\n');
    expect(listRules).toMatch(/position:\s*static/);
  });

  it('never paint-contains the control bar (menus open above it)', () => {
    for (const rule of declarationsFor('.video-js .vjs-control-bar')) {
      const contain = rule.match(/contain:\s*([^;]+);/);
      if (contain) expect(contain[1]).not.toMatch(/paint|content|strict/);
      const overflow = rule.match(/(?:^|[\s;])overflow:\s*([^;]+);/);
      if (overflow) expect(overflow[1]).toMatch(/visible/);
    }
  });
});
