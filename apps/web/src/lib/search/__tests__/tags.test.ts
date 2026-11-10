import { collectTags, lastTagSegment, replaceLastTag, splitTagList, unusedTags } from '../tags';
import { matchesSearch } from '../match';

describe('tag helpers', () => {
  it('collects tags by use, one spelling per normalised form', () => {
    expect(collectTags([{ tags: ['Fiqh', 'الصلاة'] }, { tags: ['fiqh', 'Seerah'] }, { tags: ['الصلاه'] }, { tags: null }]))
      .toEqual(['Fiqh', 'الصلاة', 'Seerah']);
  });

  it('splits comma lists on "," and the Arabic "،"', () => {
    expect(splitTagList('fiqh, صلاة، seerah ,')).toEqual(['fiqh', 'صلاة', 'seerah']);
    expect(lastTagSegment('fiqh, sal')).toBe(' sal');
    expect(lastTagSegment('صلاة، حد')).toBe(' حد');
  });

  it('replaces the tag being typed and leaves room for the next', () => {
    expect(replaceLastTag('fiqh, sal', 'Salah')).toBe('fiqh, Salah, ');
    expect(replaceLastTag('sal', 'Salah')).toBe('Salah, ');
    expect(replaceLastTag('صلاة، حد', 'حديث')).toBe('صلاة، حديث, ');
  });

  it('drops tags already used (normalised)', () => {
    expect(unusedTags(['Fiqh', 'الصلاة', 'Seerah'], ['fiqh', 'الصلاه'])).toEqual(['Seerah']);
  });
});

describe('matchesSearch', () => {
  it('matches Arabic variants and word prefixes; a blank query matches everything', () => {
    expect(matchesSearch('احكام الصلاه', 'أحكام الصَّلاة')).toBe(true);
    expect(matchesSearch('fast', 'Rules of Fasting')).toBe(true);
    expect(matchesSearch('tafsir', 'Seerah', null)).toBe(false);
    expect(matchesSearch('  ', 'anything')).toBe(true);
  });
});
