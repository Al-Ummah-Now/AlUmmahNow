import { watchIdFromPath } from '../WatchShell';

jest.mock('@/components/video/WatchPageContent', () => () => null);

describe('watchIdFromPath', () => {
  it('reads the video id of a watch page', () => {
    expect(watchIdFromPath('/en/video/abc-123')).toBe('abc-123');
    expect(watchIdFromPath('/ar/video/abc-123/')).toBe('abc-123');
  });
  it('reads the legacy /video?vid= form', () => {
    expect(watchIdFromPath('/en/video', 'abc-123')).toBe('abc-123');
    expect(watchIdFromPath('/ar/video/', 'abc-123')).toBe('abc-123');
  });
  it('leaves the editor and a legacy URL with no video alone', () => {
    expect(watchIdFromPath('/en/video/abc-123/edit', 'x')).toBeNull();
    expect(watchIdFromPath('/en/video')).toBeNull();
    expect(watchIdFromPath(null)).toBeNull();
  });
});
