import { fitWords, slotRoom } from '../FitWords';

// A fake measure: one unit a character, so "fits" means "at most `room` characters"
const fitsIn = (room: number) => (candidate: string) => candidate.length <= room;

describe('fitWords: the longest run of whole words, then «…»', () => {
  it('keeps a name that fits', () => {
    expect(fitWords('Al-Fajr Reminders', fitsIn(30))).toBe('Al-Fajr Reminders');
  });
  it('cuts at a word, never mid-word, with no space before the ellipsis', () => {
    expect(fitWords('Al-Fajr Reminders and Tafsir Circle', fitsIn(20))).toBe('Al-Fajr Reminders…');
    expect(fitWords('حلقة الفجر للتذكير والتفسير', fitsIn(20))).toBe('حلقة الفجر للتذكير…');
  });
  it('drops a trailing comma or «،» before the ellipsis', () => {
    expect(fitWords('Reminders, notes and more', fitsIn(12))).toBe('Reminders…');
    expect(fitWords('تذكير، وتفسير ودروس', fitsIn(8))).toBe('تذكير…');
  });
  it('gives back one long word whole, for the CSS ellipsis', () => {
    expect(fitWords('Supercalifragilistic', fitsIn(5))).toBe('Supercalifragilistic');
  });
});

describe('slotRoom: the room is the slot max width, so a cut never shrinks the next fit', () => {
  it('uses the max width of a slot that has one (the header chip, 9rem)', () => {
    // The chip holds "Al-Fajr…" (80px wide) but may take 144px: the room stays 144px
    expect(slotRoom(80, '144px')).toBe(144);
  });
  it('uses the laid-out width when there is no max width', () => {
    expect(slotRoom(200, 'none')).toBe(200);
  });
});
