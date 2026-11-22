import { attachmentFilename, captionDownloadPath, downloadCaptionFile } from '../caption-download';

/** jsdom has no fetch Response: the parts downloadCaptionFile reads */
function fakeResponse(status: number, disposition?: string, blob: Blob = new Blob(['WEBVTT\n'])) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => (n.toLowerCase() === 'content-disposition' ? disposition ?? null : null) }, blob: async () => blob } as unknown as Response;
}

describe('caption-download', () => {
  it('builds the same-origin Studio path for a track or a draft', () => {
    expect(captionDownloadPath('v1', 'ar', 'vtt', 'track')).toBe('/studio-download/captions/v1/track/ar.vtt');
    expect(captionDownloadPath('v_1-x', 'pt-BR', 'srt', 'draft')).toBe('/studio-download/captions/v_1-x/draft/pt-BR.srt');
  });

  it('keeps the attachment name (RFC 6266 filename* first), never a path', () => {
    expect(attachmentFilename('attachment; filename="v1-ar.vtt"', 'x')).toBe('v1-ar.vtt');
    expect(attachmentFilename("attachment; filename=\"a.srt\"; filename*=UTF-8''v1-ar-draft-v3.srt", 'x')).toBe('v1-ar-draft-v3.srt');
    expect(attachmentFilename('attachment; filename=../../etc.vtt', 'x')).toBe('.._.._etc.vtt');
    expect(attachmentFilename('attachment', 'fallback.vtt')).toBe('fallback.vtt');
    expect(attachmentFilename(null, 'fallback.vtt')).toBe('fallback.vtt');
  });

  it('fetches with the session and saves the bytes untouched under the attachment name', async () => {
    const body = 'WEBVTT\n\nNOTE\nQuran data provided by Quran Foundation\n\n00:00.000 --> 00:01.000\n﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾\n';
    const file = new Blob([body], { type: 'text/vtt' });
    const fetchMock = jest.fn(async () => fakeResponse(200, 'attachment; filename="v1-ar.vtt"', file));
    const save = jest.fn();
    const result = await downloadCaptionFile({ videoId: 'v1', language: 'ar', format: 'vtt', source: 'track' }, { fetch: fetchMock as unknown as typeof fetch, save });
    expect(result).toEqual({ ok: true, filename: 'v1-ar.vtt' });
    expect(fetchMock).toHaveBeenCalledWith('/studio-download/captions/v1/track/ar.vtt', { credentials: 'same-origin', cache: 'no-store' });
    const [blob, name] = save.mock.calls[0];
    expect(name).toBe('v1-ar.vtt');
    // The very bytes that came back: nothing re-encoded or rewritten
    expect(blob).toBe(file);
  });

  it('saves nothing when refused or offline', async () => {
    const save = jest.fn();
    const refused = jest.fn(async () => fakeResponse(404));
    expect(await downloadCaptionFile({ videoId: 'v1', language: 'ar', format: 'srt', source: 'draft' }, { fetch: refused as unknown as typeof fetch, save })).toEqual({ ok: false, status: 404 });
    const offline = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await downloadCaptionFile({ videoId: 'v1', language: 'ar', format: 'srt', source: 'draft' }, { fetch: offline as unknown as typeof fetch, save })).toEqual({ ok: false, status: 0 });
    expect(save).not.toHaveBeenCalled();
  });
});
