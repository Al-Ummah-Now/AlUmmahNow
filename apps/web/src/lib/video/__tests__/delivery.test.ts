import { deviceClass, fallbackReasonFor } from '../delivery';

describe('fallbackReasonFor', () => {
  it('names the failure from the playlist status first, then the MediaError code', () => {
    expect(fallbackReasonFor({ code: 2, status: 403 })).toBe('manifest_4xx');
    expect(fallbackReasonFor({ code: 4, status: 404 })).toBe('manifest_4xx');
    expect(fallbackReasonFor({ code: 2, status: 503 })).toBe('manifest_5xx');
    expect(fallbackReasonFor({ code: 2, status: 0 })).toBe('cors');
    expect(fallbackReasonFor({ code: 2 })).toBe('network');
    expect(fallbackReasonFor({ code: 3 })).toBe('decode');
    expect(fallbackReasonFor({ code: 4 })).toBe('unsupported');
    expect(fallbackReasonFor({})).toBe('other');
  });
});

describe('deviceClass', () => {
  it('classifies common agents', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Safari/537.36')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0)')).toBe('tv');
    expect(deviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
  });
});
