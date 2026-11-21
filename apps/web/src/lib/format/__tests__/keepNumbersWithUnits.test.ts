import { keepNumbersWithUnits, metaSeparator } from '../videoMeta';

describe('keepNumbersWithUnits', () => {
  it('ties a number to its unit and the word before it, en and ar', () => {
    expect(keepNumbersWithUnits('38% watched')).toBe('38% watched');
    expect(keepNumbersWithUnits('Watched 2 hours ago')).toBe('Watched 2 hours ago');
    expect(keepNumbersWithUnits('تمت المشاهدة قبل ٩ ساعات')).toBe('تمت المشاهدة قبل ٩ ساعات');
    expect(keepNumbersWithUnits('تمت مشاهدة ٣٨٪')).toBe('تمت مشاهدة ٣٨٪');
    expect(keepNumbersWithUnits('١٫٢ ألف مرئي')).toBe('١٫٢ ألف مرئي');
  });

  it('leaves text without numbers alone', () => {
    expect(keepNumbersWithUnits('Watched yesterday')).toBe('Watched yesterday');
  });
});

describe('metaSeparator', () => {
  it('is «، » in Arabic and " • " in English', () => {
    expect(metaSeparator('ar')).toBe('، ');
    expect(metaSeparator('en')).toBe(' • ');
  });
});
