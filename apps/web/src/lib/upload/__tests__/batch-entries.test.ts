/**
 * Batch upload entries: each file must go to the API TUS proxy with its own
 * tusSessionId (same flow as the single upload).
 */

import { buildBatchUploadEntries, getTusProxyEndpoint } from '../batch-entries';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'video/mp4' });

const session = (n: number) => ({
  videoId: `video-${n}`,
  tusSessionId: `session-${n}`,
  expiresAt: '2026-11-06T12:00:00.000Z',
  chunkSize: 5 * 1024 * 1024,
  resumable: true,
});

describe('getTusProxyEndpoint', () => {
  it('appends the proxy path and trims trailing slashes', () => {
    expect(getTusProxyEndpoint('https://api.example.com/')).toBe('https://api.example.com/api/videos/tus');
    expect(getTusProxyEndpoint('https://api.example.com')).toBe('https://api.example.com/api/videos/tus');
  });
});

describe('buildBatchUploadEntries', () => {
  it('pairs files with sessions by index (duplicate file names are fine)', () => {
    const files = [file('same.mp4'), file('same.mp4'), file('other.mp4')];
    const entries = buildBatchUploadEntries({
      files,
      sessions: [session(1), session(2), session(3)],
      apiUrl: 'https://api.example.com',
      authorization: 'Bearer token',
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.videoId)).toEqual(['video-1', 'video-2', 'video-3']);
    expect(entries[1].file).toBe(files[1]);
    expect(entries[1].tusConfig).toEqual({
      tusEndpoint: 'https://api.example.com/api/videos/tus',
      tusHeaders: { Authorization: 'Bearer token' },
      metadata: { tusSessionId: 'session-2', videoId: 'video-2' },
      chunkSize: 5 * 1024 * 1024,
      expiresAt: '2026-11-06T12:00:00.000Z',
    });
  });

  it('never exposes Bunny credentials (only the proxy endpoint and session)', () => {
    const [entry] = buildBatchUploadEntries({
      files: [file('a.mp4')],
      sessions: [session(1)],
      apiUrl: 'https://api.example.com',
      authorization: 'Bearer token',
    });
    expect(entry.tusConfig.tusEndpoint).not.toContain('bunnycdn');
    expect(Object.keys(entry.tusConfig.tusHeaders)).toEqual(['Authorization']);
  });

  it('uses an explicit chunk size override', () => {
    const [entry] = buildBatchUploadEntries({
      files: [file('a.mp4')],
      sessions: [session(1)],
      apiUrl: 'https://api.example.com',
      authorization: 'Bearer token',
      chunkSize: 1024,
    });
    expect(entry.tusConfig.chunkSize).toBe(1024);
  });

  it('throws when the API returned a different number of sessions', () => {
    expect(() => buildBatchUploadEntries({
      files: [file('a.mp4'), file('b.mp4')],
      sessions: [session(1)],
      apiUrl: 'https://api.example.com',
      authorization: 'Bearer token',
    })).toThrow(/does not match/);
  });

  it('throws when a session is missing its tusSessionId', () => {
    expect(() => buildBatchUploadEntries({
      files: [file('a.mp4')],
      sessions: [{ ...session(1), tusSessionId: '' }],
      apiUrl: 'https://api.example.com',
      authorization: 'Bearer token',
    })).toThrow(/Missing TUS session/);
  });
});
