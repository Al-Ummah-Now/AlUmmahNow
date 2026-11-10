import { act, renderHook } from '@testing-library/react';
import { clearUploadResult, publishUploadResult, useUploadResult, videoIdFromActionUrl } from '../upload-results';

describe('upload results store', () => {
  it('reads the video id from a stored action URL, with or without a locale', () => {
    expect(videoIdFromActionUrl('/video/abc')).toBe('abc');
    expect(videoIdFromActionUrl('/ar/video/abc/edit')).toBe('abc');
    expect(videoIdFromActionUrl('/channel/abc')).toBeNull();
  });

  it('forgets a result when the same video is uploaded again', () => {
    const { result } = renderHook(() => useUploadResult('re-1'));
    expect(result.current).toBeNull();
    act(() => publishUploadResult('re-1', 'failed'));
    expect(result.current).toBe('failed');

    // The re-upload starts: the old "couldn't be processed" must not show for it
    act(() => clearUploadResult('re-1'));
    expect(result.current).toBeNull();
    act(() => publishUploadResult('re-1', 'ready'));
    expect(result.current).toBe('ready');
  });
});
