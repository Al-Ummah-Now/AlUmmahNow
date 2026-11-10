import { needsReupload, reuploadHref } from '../reupload';
import type { VideoObject } from '@/interfaces';

const video = (v: Partial<VideoObject>) => ({ id: 'v1', title: 'Talk', ...v }) as VideoObject;

describe('studio re-upload action', () => {
  it('shows for an upload flagged needs_reupload and for an older failed upload, not otherwise', () => {
    expect(needsReupload(video({ uploadStatus: 'failed', processingIssue: { kind: 'needs_reupload', reason: 'gone' } }))).toBe(true);
    expect(needsReupload(video({ uploadStatus: 'failed' }))).toBe(true);
    expect(needsReupload(video({ uploadStatus: 'uploading' }))).toBe(false);
    expect(needsReupload(video({ uploadStatus: 'ready' }))).toBe(false);
    expect(needsReupload(video({ uploadStatus: 'processing', processingIssue: { kind: 'stalled' } }))).toBe(false);
  });

  it('links to the upload page in re-upload mode for the same video', () => {
    expect(reuploadHref('ar', video({ id: 'a b', title: 'محاضرة & Q' }))).toBe(
      `/ar/upload?resume=a+b&title=${encodeURIComponent('محاضرة').replace(/%20/g, '+')}+%26+Q`,
    );
    expect(reuploadHref('en', video({ title: '' }))).toBe('/en/upload?resume=v1');
  });
});
