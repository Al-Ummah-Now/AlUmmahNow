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

    await act(async () => void result.current.start('avatar', photo('one')));
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

  it('a removal waits for the upload of the same photo, and a photo picked during a removal waits for it', async () => {
    const order: string[] = [];
    const uploads = [deferred(), deferred()];
    let n = 0;
    const { result } = renderHook(() =>
      usePhotoUploads<'avatar'>(async (_, file) => {
        order.push(`upload ${file.name}`);
        await uploads[n++].promise;
      }),
    );
    const removal = deferred();
    let removed!: Promise<void>;
    await act(async () => void result.current.start('avatar', photo('one')));
    act(() => {
      removed = result.current.run('avatar', async () => {
        order.push('remove');
        await removal.promise;
      });
    });
    act(() => void result.current.start('avatar', photo('two')));
    expect(order).toEqual(['upload one']);
    await act(async () => uploads[0].resolve());
    expect(order).toEqual(['upload one', 'remove']);
    await act(async () => {
      removal.resolve();
      await removed;
    });
    expect(order).toEqual(['upload one', 'remove', 'upload two']);
    await act(async () => uploads[1].resolve());
    expect(result.current.uploading.avatar).toBe(false);
  });
});
