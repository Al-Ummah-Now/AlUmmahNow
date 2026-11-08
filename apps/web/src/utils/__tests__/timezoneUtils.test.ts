import { isListedTimezone } from '../timezoneUtils';

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
