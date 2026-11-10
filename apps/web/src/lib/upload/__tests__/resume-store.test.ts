/**
 * The file -> video map that lets a reload or crash resume the same video.
 */
import { REMEMBERED_UPLOAD_TTL_MS, findRememberedUpload, forgetUpload, rememberUpload } from '../resume-store';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const file = { name: 'talk.mp4', size: 1234, lastModified: 42 };

describe('resume store', () => {
  it('remembers which video a file goes into, per channel', () => {
    const s = memoryStorage();
    rememberUpload(file, 'ch1', 'v1', 1000, s);
    expect(findRememberedUpload(file, 'ch1', 2000, s)).toEqual({ videoId: 'v1', channelId: 'ch1', savedAt: 1000 });
    expect(findRememberedUpload(file, 'ch2', 2000, s)).toBeNull();
    expect(findRememberedUpload({ ...file, size: 1 }, 'ch1', 2000, s)).toBeNull();
  });

  it('forgets on success/cancel and after 7 days', () => {
    const s = memoryStorage();
    rememberUpload(file, 'ch1', 'v1', 0, s);
    expect(findRememberedUpload(file, 'ch1', REMEMBERED_UPLOAD_TTL_MS + 1, s)).toBeNull();
    rememberUpload(file, 'ch1', 'v2', 10, s);
    forgetUpload(file, 'ch1', 20, s);
    expect(findRememberedUpload(file, 'ch1', 30, s)).toBeNull();
  });

  it('survives broken or blocked storage', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    expect(findRememberedUpload(file, 'ch1', 0, broken)).toBeNull();
    expect(() => rememberUpload(file, 'ch1', 'v1', 0, broken)).not.toThrow();
    expect(() => rememberUpload(file, 'ch1', 'v1', 0, null)).not.toThrow();
  });
});
