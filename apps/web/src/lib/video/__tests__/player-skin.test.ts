/**
 * The player skin's CSS contract (docs/specs/VIDEO-PLAYER.md sections 3, 5 and 6).
 *
 * jsdom does no layout, so this pins the rules that keep the production defects from coming
 * back; the Playwright player specs check the rendered result in Chromium, Firefox and WebKit.
 */
import fs from 'fs';
import path from 'path';
import { playerTokenNames } from '@/test/player-themes';

const skin = fs.readFileSync(path.join(__dirname, '../../../styles/player-skin.css'), 'utf8');
const legacy = fs.readFileSync(path.join(__dirname, '../../../styles/video-player.css'), 'utf8');
const uncommented = skin.replace(/\/\*[\s\S]*?\*\//g, '');

/** Declarations of every rule whose selector list contains `selector`, outside at-rules too */
function declarationsFor(selector: string, css = uncommented): string {
  const rules: string[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(css)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) rules.push(match[2]);
  }
  return rules.join('\n');
}

/** The body of every `@media <query>` block (one nesting level) */
function mediaBlocks(query: string): string {
  const out: string[] = [];
  let at = uncommented.indexOf(`@media ${query}`);
  while (at >= 0) {
    let depth = 0;
    let i = uncommented.indexOf('{', at);
    const start = i + 1;
    for (; i < uncommented.length; i++) {
      if (uncommented[i] === '{') depth++;
      else if (uncommented[i] === '}' && --depth === 0) break;
    }
    out.push(uncommented.slice(start, i));
    at = uncommented.indexOf(`@media ${query}`, i);
  }
  return out.join('\n');
}

describe('player skin CSS', () => {
  it('takes every colour from the theme tokens', () => {
    expect(uncommented).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(uncommented).not.toMatch(/\b(rgba?|hsla?|oklch|color-mix)\(/i);
    const used = new Set(Array.from(uncommented.matchAll(/var\(--fanous-player-([a-z-]+)\)/g), (m) => m[1]));
    const known = new Set(playerTokenNames());
    expect([...used].filter((t) => !known.has(t))).toEqual([]);
    // The old --vp- variables are gone from both stylesheets
    expect(skin + legacy).not.toMatch(/--vp-/);
  });

  it('is scoped to the fanous player so other Video.js players keep the default look', () => {
    const selectors = Array.from(uncommented.matchAll(/([^{}@;]+)\{[^{}]*\}/g), (m) => m[1].trim())
      .flatMap((s) => s.split(',').map((x) => x.trim()))
      .filter((s) => s && !/^(from|to|\d+%)$/.test(s));
    const unscoped = selectors.filter((s) => !/vjs-fanous|\.custom-video-player|\[data-theatre\]/.test(s));
    expect(unscoped).toEqual([]);
  });

  it('never clips the scrub handle', () => {
    const holder = declarationsFor('.video-js.vjs-fanous .vjs-progress-control .vjs-progress-holder');
    expect(holder).toMatch(/contain:\s*none/);
    expect(holder).toMatch(/overflow:\s*visible/);
    // Half the hover handle of room at each end, so 0% and 100% are fully visible
    expect(holder).toMatch(/margin:\s*0 calc\(var\(--vjs-fanous-handle-active\) \/ 2\)/);
    expect(declarationsFor('.video-js.vjs-fanous .vjs-progress-control')).toMatch(/overflow:\s*visible/);
  });

  it('keeps the production bar: 12px track, 16px on hover and while scrubbing', () => {
    expect(declarationsFor('.video-js.vjs-fanous .vjs-progress-control .vjs-progress-holder')).toMatch(/height:\s*12px/);
    expect(declarationsFor('.video-js.vjs-fanous.vjs-scrubbing .vjs-progress-control .vjs-progress-holder')).toMatch(/height:\s*16px/);
  });

  it('clips the video to the frame radius in one place', () => {
    const frame = declarationsFor('.video-js.vjs-fanous');
    expect(frame).toMatch(/border-radius:\s*var\(--fanous-radius-lg/);
    expect(frame).toMatch(/overflow:\s*hidden/);
    expect(frame).toMatch(/isolation:\s*isolate/);
    // Nothing paints a square behind the rounded player
    expect(declarationsFor('.custom-video-player')).toMatch(/background:\s*transparent/);
  });

  it('hides the bar with the controls, but not while the settings menu is open', () => {
    expect(declarationsFor('.video-js.vjs-fanous.vjs-has-started.vjs-user-inactive.vjs-playing:not(.vjs-menu-open) .vjs-control-bar'))
      .toMatch(/opacity:\s*0/);
    expect(declarationsFor('.video-js.vjs-fanous.vjs-menu-open .vjs-control-bar')).toMatch(/opacity:\s*1/);
    for (const state of ['vjs-controls-disabled', 'vjs-using-native-controls', 'vjs-error']) {
      expect(declarationsFor(`.video-js.vjs-fanous.${state} .vjs-control-bar`)).toMatch(/display:\s*none/);
    }
  });

  it('draws hover only on devices that hover, and pressed after hover', () => {
    const outsideHoverMedia = uncommented.replace(/@media \(hover: hover\) \{[\s\S]*?\n\}/g, '');
    expect(outsideHoverMedia).not.toMatch(/\.vjs-button:hover/);
    expect(outsideHoverMedia).not.toMatch(/\.vjs-fanous-mi:hover/);
    const hoverAt = skin.indexOf('.vjs-button:hover::before');
    const pressAt = skin.indexOf('.vjs-button:active::before');
    expect(hoverAt).toBeGreaterThan(0);
    expect(pressAt).toBeGreaterThan(hoverAt);
  });

  it('shows focus rings for keyboard focus only', () => {
    // A plain :focus rule may undo Video.js layout, but never draws a ring
    const plainFocus = Array.from(uncommented.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter((m) => /:focus(?![-\w])/.test(m[1]));
    for (const [, , body] of plainFocus) expect(body).not.toMatch(/outline|box-shadow/);
    expect(uncommented).toMatch(/::-moz-focus-inner/);
  });

  it('replaces the icon font with inline SVG', () => {
    expect(declarationsFor('.video-js.vjs-fanous .vjs-icon-placeholder::before')).toMatch(/content:\s*none/);
    expect(declarationsFor('.video-js.vjs-fanous .vjs-volume-bar .vjs-volume-level::before')).toMatch(/content:\s*none/);
  });

  it('gives the settings panel a solid or blurred surface, placed in the layer over the frame', () => {
    const menu = declarationsFor('.vjs-fanous-layer.vjs-fanous-menu');
    expect(menu).toMatch(/position:\s*fixed/);
    expect(menu).toMatch(/background:\s*var\(--fanous-player-menu\)/);
    expect(menu).toMatch(/backdrop-filter:\s*blur\(16px\)/);
    expect(menu).toMatch(/border-radius:\s*12px/);
    expect(declarationsFor('.vjs-fanous-menu .vjs-fanous-mi')).toMatch(/--vjs-fanous-mi-h:\s*44px/);
    expect(declarationsFor('.vjs-fanous-menu .vjs-fanous-mi-option[aria-checked="true"]')).toMatch(/var\(--fanous-player-menu-selected\)/);
  });

  it('stacks every portalled layer on the layer token, resets buttons there, and gives dialogs a scrim', () => {
    expect(declarationsFor('.vjs-fanous-layer')).toMatch(/z-index:\s*var\(--fanous-player-layer\)/);
    expect(declarationsFor('.vjs-fanous-layer button')).toMatch(/appearance:\s*none/);
    const scrim = declarationsFor('.vjs-fanous-layer.vjs-fanous-dialog-layer');
    expect(scrim).toMatch(/position:\s*fixed/);
    expect(scrim).toMatch(/inset:\s*0/);
    expect(scrim).toMatch(/background:\s*var\(--fanous-player-scrim\)/);
    const tip = declarationsFor('.vjs-fanous-layer.vjs-fanous-tip');
    expect(tip).toMatch(/position:\s*fixed/);
    expect(tip).toMatch(/pointer-events:\s*none/);
    // Video.js's own time tooltip and the markers' tips are gone in favour of the layer's
    expect(declarationsFor('.video-js.vjs-fanous .vjs-progress-control .vjs-mouse-display .vjs-time-tooltip')).toMatch(/display:\s*none/);
    expect(uncommented).not.toMatch(/vjs-fanous-chapter-tip/);
  });

  it('mirrors the submenu slide in Arabic and drops motion when asked', () => {
    expect(declarationsFor('.vjs-fanous-layer.vjs-fanous-menu[dir="rtl"] .vjs-fanous-menu-view')).toMatch(/vjs-fanous-in-start/);
    expect(mediaBlocks('(prefers-reduced-motion: reduce)')).toMatch(/animation-duration:\s*0\.01ms/);
  });

  it('supports more contrast and forced colours', () => {
    expect(mediaBlocks('(prefers-contrast: more)')).toMatch(/\.vjs-control-bar/);
    expect(mediaBlocks('(forced-colors: active)')).toMatch(/Highlight/);
    // `high` is not a valid prefers-contrast value; it never matched
    expect(skin + legacy).not.toMatch(/prefers-contrast:\s*high/);
  });

  it('keeps 44px targets for touch and hides secondary controls in narrow players', () => {
    expect(mediaBlocks('(pointer: coarse)')).toMatch(/height:\s*44px/);
    expect(uncommented).toMatch(/@container fanous-player \(max-width: 479px\)[\s\S]*vjs-picture-in-picture-control/);
    expect(uncommented).toMatch(/@container fanous-player \(max-width: 359px\)[\s\S]*vjs-fanous-next/);
  });

  it('nudges play triangles by whole pixels, with a rounding the minifier keeps', () => {
    // 7% of the 22px bar icon is 1.54px; a fractional transform is snapped differently per browser.
    // A two-argument round() is folded away by the CSS pipeline, so the strategy is spelt out.
    const nudges = uncommented.match(/transform:\s*translateX\([^;]*--vjs-fanous-play-nudge[^;]*;/g) ?? [];
    expect(nudges.length).toBeGreaterThanOrEqual(2);
    for (const n of nudges) expect(n).toContain('translateX(round(nearest, var(--vjs-fanous-play-nudge), 1px))');
    expect(declarationsFor('.video-js.vjs-fanous [data-icon="play"]')).toContain('round(nearest, var(--vjs-fanous-play-nudge), 1px)');
  });
});
