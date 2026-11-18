import { glueDashes } from '../glueDashes';

describe('glueDashes', () => {
  it('glues an em or en dash to the word before it, never the one after', () => {
    expect(glueDashes('Surah Al-Kahf — full recitation')).toBe('Surah Al-Kahf — full recitation');
    expect(glueDashes('سورة الكهف — تلاوة كاملة')).toBe('سورة الكهف — تلاوة كاملة');
    expect(glueDashes('Part 1 – Tafsir')).toBe('Part 1 – Tafsir');
  });

  it('leaves titles without a spaced dash alone', () => {
    expect(glueDashes('Al-Kahf')).toBe('Al-Kahf');
    expect(glueDashes('Tafsir—notes')).toBe('Tafsir—notes');
    expect(glueDashes('')).toBe('');
  });
});
