import { META_DESCRIPTION_MAX, metaDescription } from '../description';

describe('metaDescription', () => {
  it('keeps short text, collapsing whitespace', () => {
    expect(metaDescription('  A  short\n description ')).toBe('A short description');
  });
  it('cuts long text at a word near 160 characters with an ellipsis', () => {
    const out = metaDescription('word '.repeat(60));
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith('word…')).toBe(true);
  });
  it('cuts text with no spaces at the limit', () => {
    expect(metaDescription('x'.repeat(300))).toHaveLength(META_DESCRIPTION_MAX);
  });
});
