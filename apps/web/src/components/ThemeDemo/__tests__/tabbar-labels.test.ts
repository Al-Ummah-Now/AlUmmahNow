import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The phone tab bar mixes links (Home, Explore, Upload, Subscriptions, You) and one button (More).
 * Every label must be the same size: a `font` shorthand on the button rule reset its label to the
 * page's 16px while the links stayed at `.tb`'s 11px (#1502).
 */
describe('phone tab bar labels', () => {
  const css = readFileSync(join(__dirname, '../../../theme/system.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*button\.tb[^{}]*)\{([^}]*)\}/g)];

  it('has a rule for the More button', () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it('never resets the button label size with the font shorthand or a font-size of its own', () => {
    for (const [, , body] of rules) {
      expect(body).not.toMatch(/(^|;)\s*font\s*:/);
      expect(body).not.toMatch(/(^|;)\s*font-size\s*:/);
    }
  });

  it('gives tab labels one size', () => {
    expect(css).toMatch(/\.tb\{[^}]*font-size:11px/);
  });
});
