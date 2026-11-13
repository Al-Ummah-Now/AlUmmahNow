import { checkPickedFile } from '../picked-file';
import { findRememberedUpload, forgetUpload, rememberUpload } from '../resume-store';

const file = { name: 'lecture.mp4', size: 1234, lastModified: 1700000000000 };
const channel = 'ch-1';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('checkPickedFile', () => {
  let storage: ReturnType<typeof memoryStorage>;
  const deps = (resume: (id: string) => Promise<never> | Promise<unknown>) => ({
    resume: resume as never,
    find: (f: typeof file, c: string) => findRememberedUpload(f, c, Date.now(), storage),
    forget: (f: typeof file, c: string) => forgetUpload(f, c, Date.now(), storage),
  });

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('a file never uploaded here is uploaded, without asking the server', async () => {
    const resume = jest.fn();
    expect(await checkPickedFile(file, channel, deps(resume))).toEqual({ kind: 'upload' });
    expect(resume).not.toHaveBeenCalled();
  });

  it('a finished upload of the same file is "already uploaded", with its video', async () => {
    rememberUpload(file, channel, 'v-done', Date.now(), storage);
    const resume = jest.fn().mockResolvedValue({ kind: 'completed' });
    expect(await checkPickedFile(file, channel, deps(resume))).toEqual({ kind: 'uploaded', videoId: 'v-done' });
    expect(resume).toHaveBeenCalledWith('v-done');
    // Still remembered: picking it again says the same
    expect(findRememberedUpload(file, channel, Date.now(), storage)?.videoId).toBe('v-done');
  });

  it('only the same channel counts', async () => {
    rememberUpload(file, 'other-channel', 'v-done', Date.now(), storage);
    const resume = jest.fn().mockResolvedValue({ kind: 'completed' });
    expect(await checkPickedFile(file, channel, deps(resume))).toEqual({ kind: 'upload' });
  });

  it('an unfinished upload is uploaded (the form resumes it at its offset)', async () => {
    rememberUpload(file, channel, 'v-part', Date.now(), storage);
    const resume = jest.fn().mockResolvedValue({ kind: 'grant', tusSessionId: 's' });
    expect(await checkPickedFile(file, channel, deps(resume))).toEqual({ kind: 'upload' });
    expect(findRememberedUpload(file, channel, Date.now(), storage)?.videoId).toBe('v-part');
  });

  it('a video that is gone is forgotten and the file uploaded as new', async () => {
    rememberUpload(file, channel, 'v-gone', Date.now(), storage);
    const resume = jest.fn().mockResolvedValue({ kind: 'gone', message: 'Video not found' });
    expect(await checkPickedFile(file, channel, deps(resume))).toEqual({ kind: 'upload' });
    expect(findRememberedUpload(file, channel, Date.now(), storage)).toBeNull();
  });

  it('a failed check keeps the record (the form checks again when it is sent)', async () => {
    rememberUpload(file, channel, 'v-done', Date.now(), storage);
    const resume = jest.fn().mockRejectedValue(new Error('upload resume 503'));
    expect(await checkPickedFile(file, channel, deps(resume))).toEqual({ kind: 'upload' });
    expect(findRememberedUpload(file, channel, Date.now(), storage)?.videoId).toBe('v-done');
  });
});
