import {
  COMMON_TIMEZONES,
  getTimezoneDisplayName,
  timezoneOptionLabel,
  isListedTimezone,
  localizedTimezoneLabel,
  localizedTimezoneRegion,
} from '../timezoneUtils';

describe('isListedTimezone', () => {
  it('recognises dropdown timezones', () => {
    expect(isListedTimezone('Asia/Dubai')).toBe(true);
    expect(isListedTimezone('America/New_York')).toBe(true);
  });

  it('flags zones the dropdown does not list (they need their own option)', () => {
    expect(isListedTimezone('UTC')).toBe(false);
    expect(isListedTimezone('Pacific/Chatham')).toBe(false);
  });
});

describe('localized timezone names (#299)', () => {
  it('has an Arabic name for every listed timezone and region', () => {
    for (const [region, zones] of Object.entries(COMMON_TIMEZONES)) {
      expect(localizedTimezoneRegion(region, 'ar')).not.toBe(region);
      for (const tz of zones) expect(localizedTimezoneLabel(tz, 'ar')).not.toBe(tz.label);
    }
  });

  it('keeps English labels for English', () => {
    expect(localizedTimezoneLabel({ value: 'Asia/Riyadh', label: 'Riyadh (AST)' }, 'en')).toBe('Riyadh (AST)');
    expect(getTimezoneDisplayName('Asia/Riyadh', 'ar')).toBe('الرياض \u2066UTC+٣\u2069');
    // #1657: Arabic digits, and the bracketed offset kept left to right so its brackets never flip
    expect(getTimezoneDisplayName('Etc/UTC', 'ar')).toMatch(/\u2066\(UTC\+٠\)\u2069$/);
    expect(timezoneOptionLabel({ value: 'Asia/Riyadh', label: 'Riyadh (AST)', offset: 'UTC+3' }, 'ar')).toBe('الرياض \u2066(UTC+٣)\u2069');
    expect(timezoneOptionLabel({ value: 'Asia/Riyadh', label: 'Riyadh (AST)', offset: 'UTC+3' }, 'en')).toBe('Riyadh (AST) (UTC+3)');
  });
});
