/**
 * Meta lines join with «،» in Arabic (a dot beside Arabic digits reads as zero «٠»); English keeps
 * whichever dot the site already used.
 */
import { joinMeta, metaMark, metaSeparator } from '../meta-separator';

describe('metaMark', () => {
  it('is the Arabic comma in Arabic, whatever English mark the site uses', () => {
    expect(metaMark('ar')).toBe('،');
    expect(metaMark('ar', '·')).toBe('،');
  });

  it('is the bullet by default in English, or the middle dot when asked', () => {
    expect(metaMark('en')).toBe('•');
    expect(metaMark('en', '·')).toBe('·');
  });
});

describe('metaSeparator', () => {
  it('Arabic: comma then one space, no space before it', () => {
    expect(metaSeparator('ar')).toBe('، ');
    expect(metaSeparator('ar', '·')).toBe('، ');
  });

  it('English: the mark spaced on both sides', () => {
    expect(metaSeparator('en')).toBe(' • ');
    expect(metaSeparator('en', '·')).toBe(' · ');
  });
});

describe('joinMeta', () => {
  it('joins Arabic parts with «، » and never a dot', () => {
    const line = joinMeta('ar', ['مشاهدتان', 'قبل ٥ دقائق']);
    expect(line).toBe('مشاهدتان، قبل ٥ دقائق');
    expect(line).not.toMatch(/[•·]/);
  });

  it('joins English parts with the site mark', () => {
    expect(joinMeta('en', ['2 views', '5 minutes ago'])).toBe('2 views • 5 minutes ago');
    expect(joinMeta('en', ['3 videos', 'Public'], '·')).toBe('3 videos · Public');
  });

  it('drops empty parts (null, undefined, false, "") so no separator dangles', () => {
    expect(joinMeta('ar', [null, 'مشاهدتان', '', undefined, false, 'قبل ٥ دقائق'])).toBe('مشاهدتان، قبل ٥ دقائق');
    expect(joinMeta('en', ['2 views', null, ''])).toBe('2 views');
    expect(joinMeta('en', [null, undefined, false, ''])).toBe('');
  });
});
