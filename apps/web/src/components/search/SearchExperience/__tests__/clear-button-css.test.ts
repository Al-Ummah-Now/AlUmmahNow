import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The search box's clear button (×) is centred by Tailwind's `top-1/2 -translate-y-1/2`, which sets
 * the `translate` property. The theme rule for the same button once added `transform: translateY(-50%)`
 * as well; `translate` and `transform` both apply, so the × sat 50% too high, on the box's top edge.
 */
describe('search clear button', () => {
  const css = readFileSync(join(__dirname, '../../../../theme/system.css'), 'utf8');
  const rule = css.match(/\[data-testid=search-input-clear\]\{([^}]*)\}/)?.[1] ?? '';

  it('is centred once: the theme rule never adds a transform on top of the translate', () => {
    expect(rule).not.toBe('');
    expect(rule).toMatch(/top:50%/);
    expect(rule).toMatch(/translate:0 -50%/);
    expect(rule).not.toMatch(/transform:\s*translate/);
  });
});
