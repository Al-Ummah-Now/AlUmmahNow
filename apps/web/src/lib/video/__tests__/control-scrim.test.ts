/**
 * Control-bar legibility: a bottom gradient scrim behind the controls.
 *
 * The bar itself stays transparent (the owner prefers the light production
 * look over a solid bar). The scrim covers more than the bar, shows and hides
 * with the controls, and stays while a popup menu is open. jsdom does no
 * layout, so this pins the CSS contract; the E2E spec checks it in Chrome.
 */
import fs from 'fs';
import path from 'path';

const playerCss = fs.readFileSync(path.join(__dirname, '../../../styles/video-player.css'), 'utf8');

/** Declarations of every rule whose selector list contains `selector` */
function declarationsFor(selector: string): string {
  const rules: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(playerCss)) !== null) {
    const selectors = match[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (selectors.includes(selector)) rules.push(match[2].replace(/\/\*[\s\S]*?\*\//g, ''));
  }
  return rules.join('\n');
}

describe('control-bar scrim CSS', () => {
  it('draws a bottom gradient over the player, taller than the bar', () => {
    const scrim = declarationsFor('.video-js::after');
    expect(scrim).toMatch(/position:\s*absolute/);
    expect(scrim).toMatch(/bottom:\s*0/);
    expect(scrim).toMatch(/height:\s*var\(--vp-scrim-height\)/);
    expect(scrim).toMatch(/background:\s*var\(--vp-scrim\)/);
    expect(scrim).toMatch(/pointer-events:\s*none/);
    expect(scrim).toMatch(/transition:\s*opacity/);
    expect(playerCss).toMatch(/--vp-scrim:\s*linear-gradient\(to top, rgba\(0, 0, 0, 0\.75\), rgba\(0, 0, 0, 0\.35\) 60%, rgba\(0, 0, 0, 0\)\)/);
    expect(playerCss).toMatch(/--vp-scrim-height:\s*max\(30%, [\d.]+rem\)/);
  });

  it('fades out with the controls, but not while a menu is open', () => {
    const hidden = declarationsFor('.video-js.vjs-has-started.vjs-user-inactive.vjs-playing:not(.vjs-menu-open)::after');
    expect(hidden).toMatch(/opacity:\s*0/);
    expect(declarationsFor('.video-js.vjs-menu-open .vjs-control-bar')).toMatch(/opacity:\s*1/);
  });

  it('is not drawn without custom controls', () => {
    for (const state of ['vjs-controls-disabled', 'vjs-using-native-controls', 'vjs-error']) {
      expect(declarationsFor(`.video-js.${state}::after`)).toMatch(/display:\s*none/);
    }
  });

  it('keeps the control bar itself transparent (no solid bar outside high-contrast mode)', () => {
    const bar = declarationsFor('.video-js .vjs-control-bar');
    const backgrounds = Array.from(bar.matchAll(/background:\s*([^;]+);/g)).map((m) => m[1].trim());
    expect(backgrounds[0]).toBe('transparent');
    // Any other bar background lives in the opt-in `prefers-contrast: high` block
    const highContrast = playerCss.slice(playerCss.indexOf('@media (prefers-contrast: high)'));
    for (const value of backgrounds.slice(1)) expect(highContrast).toContain(`background: ${value};`);
  });

  it('gives the popup menu a solid dark rounded surface with padding', () => {
    const menu = declarationsFor('.video-js .vjs-menu-button-popup .vjs-menu');
    expect(menu).toMatch(/background:\s*var\(--vp-menu-bg\)/);
    expect(menu).toMatch(/border-radius:\s*0\.5rem/);
    expect(menu).toMatch(/padding:\s*0\.25rem 0/);
    expect(playerCss).toMatch(/--vp-menu-bg:\s*rgba\(17, 24, 39, 0\.9\d?\)/);
  });

  it('never shows a popup menu on hover alone', () => {
    expect(declarationsFor('.video-js.vjs-workinghover .vjs-menu-button-popup.vjs-hover .vjs-menu:not(.vjs-lock-showing)'))
      .toMatch(/display:\s*none/);
  });
});
