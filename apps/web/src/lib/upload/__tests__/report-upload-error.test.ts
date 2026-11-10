/** Upload failures are reported with step, file count, sizes and HTTP status; never file names. */
const report = jest.fn((..._args: unknown[]) => 'ERR-AAAA-BBBB');
jest.mock('@/lib/errors/reporter', () => ({ reportError: (...args: unknown[]) => report(...args) }));

import { reportUploadError, uploadErrorMessage, uploadErrorStatus } from '../report-upload-error';

const file = (name: string, size: number, type = 'video/mp4') => new File([new Uint8Array(size)], name, { type });

describe('reportUploadError', () => {
  beforeEach(() => report.mockClear());

  it('a batch initiate failure: step, file count, total size and the status', () => {
    const files = Array.from({ length: 11 }, (_, i) => file(`my private name ${i}.mp4`, 1000 + i));
    const ref = reportUploadError('initiate', new Error('Failed to initiate batch upload'), { files, status: 503, serverRef: 'ERR-SRVR-0001' });
    expect(ref).toBe('ERR-AAAA-BBBB');
    const [err, opts] = report.mock.calls[0] as [Error, { kind: string; shown: boolean; status: number; extra: Record<string, unknown> }];
    expect(err.message).toBe('Failed to initiate batch upload');
    expect(opts).toMatchObject({ kind: 'upload', shown: true, status: 503 });
    expect(opts.extra).toMatchObject({ step: 'initiate', flow: 'batch', fileCount: 11, totalBytes: 11 * 1000 + 55, mimeType: 'video/mp4', serverRef: 'ERR-SRVR-0001' });
    expect(JSON.stringify(opts)).not.toContain('private name');
  });

  it('a TUS failure carries the HTTP status from the tus error and the bytes sent', () => {
    const tusError = Object.assign(new Error('tus: failed to upload chunk'), { originalResponse: { getStatus: () => 413 } });
    reportUploadError('tus', tusError, { file: file('a.mov', 5000, 'video/quicktime'), videoId: 'v1', bytesUploaded: 2048 });
    const opts = report.mock.calls[0][1] as { status: number; extra: Record<string, unknown> };
    expect(opts.status).toBe(413);
    expect(opts.extra).toMatchObject({ step: 'tus', fileCount: 1, fileBytes: 5000, mimeType: 'video/quicktime', videoId: 'v1', bytesUploaded: 2048 });
  });

  it('a string error becomes an Error', () => {
    reportUploadError('complete', 'Video not found');
    expect((report.mock.calls[0][0] as Error).message).toBe('Video not found');
  });

  it('reads no status from errors without a response', () => {
    expect(uploadErrorStatus(new Error('x'))).toBeUndefined();
    expect(uploadErrorStatus(null)).toBeUndefined();
  });

  it('shows the friendly message with the reference, in the page language', () => {
    expect(uploadErrorMessage('Upload failed.', 'ERR-AAAA-BBBB', 'en')).toBe('Upload failed. (Reference: ERR-AAAA-BBBB)');
    expect(uploadErrorMessage('فشل الرفع.', 'ERR-AAAA-BBBB', 'ar')).toBe('فشل الرفع. (الرقم المرجعي: ERR-AAAA-BBBB)');
    expect(uploadErrorMessage('Upload failed.', '', 'en')).toBe('Upload failed.');
  });
});
