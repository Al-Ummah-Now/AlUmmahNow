import { channelLabel } from '../channel-name';

/** Arabic pages showed English channel names under Arabic titles (owner, 2026-11-13). */
const video = { channelName: 'Al Ummah Now', channelNameLocalized: { en: 'Al Ummah Now', ar: 'الأمة الآن' } };

describe('channelLabel', () => {
  it("shows the page language's name", () => {
    expect(channelLabel(video, 'ar')).toBe('الأمة الآن');
    expect(channelLabel(video, 'en')).toBe('Al Ummah Now');
  });

  it('falls back to the default name, then the legacy channel field, then any language', () => {
    expect(channelLabel({ channelName: 'Noor', channelNameLocalized: { en: 'Noor' } }, 'ar')).toBe('Noor');
    expect(channelLabel({ channel: 'Old Name' }, 'ar')).toBe('Old Name');
    expect(channelLabel({ channelName: '', channelNameLocalized: { ar: 'قناة' } }, 'en')).toBe('قناة');
  });

  it('ignores blank names and missing items', () => {
    expect(channelLabel({ channelName: 'Noor', channelNameLocalized: { ar: '  ' } }, 'ar')).toBe('Noor');
    expect(channelLabel(undefined, 'ar')).toBe('');
    expect(channelLabel(null, 'en')).toBe('');
  });
});
