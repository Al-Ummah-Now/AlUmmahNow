/** A photo upload never blocks the next pick, and the last pick is the one the server keeps. */
import { act, renderHook } from '@testing-library/react';
import { usePhotoUploads } from '../usePhotoUploads';

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePhotoUploads', () => {
  const revoked: string[] = [];
  beforeEach(() => {
    let n = 0;
    revoked.length = 0;
    URL.createObjectURL = jest.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = jest.fn((url: string) => void revoked.push(url));
  });

  it('shows a new photo at once, sends one at a time, and skips photos replaced before their turn', async () => {
    const sent: string[] = [];
    const running = [deferred(), deferred()];
    const { result } = renderHook(() =>
      usePhotoUploads<'avatar' | 'cover'>((_, file) => {
        sent.push(file.name);
        return running[sent.length - 1].promise;
      }),
    );

    act(() => void result.current.start('avatar', photo('one')));
    expect(result.current.previews.avatar).toBe('blob:1');
    expect(result.current.uploading.avatar).toBe(true);

    act(() => void result.current.start('avatar', photo('two')));
    act(() => void result.current.start('avatar', photo('three')));
    expect(result.current.previews.avatar).toBe('blob:3');
    expect(sent).toEqual(['one']);

    await act(async () => running[0].resolve());
    expect(sent).toEqual(['one', 'three']);
    expect(result.current.previews.avatar).toBe('blob:3');
    expect(result.current.uploading.avatar).toBe(true);

    await act(async () => running[1].resolve());
    expect(result.current.uploading.avatar).toBe(false);
    expect(result.current.previews.avatar).toBeUndefined();
    expect(revoked).toEqual(['blob:1', 'blob:2', 'blob:3']);
  });

  it('keeps the avatar and the cover apart', () => {
    const { result } = renderHook(() => usePhotoUploads<'avatar' | 'cover'>(() => new Promise<void>(() => undefined)));
    act(() => void result.current.start('avatar', photo('a')));
    expect(result.current.uploading.avatar).toBe(true);
    expect(result.current.uploading.cover).toBeFalsy();
  });

  it('drops the preview when the upload fails, and can upload again', async () => {
    const upload = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePhotoUploads<'avatar'>(upload));
    await act(async () => {
      await result.current.start('avatar', photo('a')).catch(() => undefined);
    });
    expect(result.current.previews.avatar).toBeUndefined();
    expect(result.current.uploading.avatar).toBe(false);
    await act(async () => {
      await result.current.start('avatar', photo('b'));
    });
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
