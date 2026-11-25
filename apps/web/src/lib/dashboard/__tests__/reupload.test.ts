import { AR_TRANSLATIONS, EN_TRANSLATIONS, UPLOAD_ISSUE_CODES } from '@al-ummah/shared-types';
import { canReupload, needsReupload, reuploadHref, uploadIssueText } from '../reupload';
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

  it('says why in the page language, by code, else by kind; the stored English reason is never shown', () => {
    for (const { issue } of [EN_TRANSLATIONS.upload, AR_TRANSLATIONS.upload]) {
      for (const code of UPLOAD_ISSUE_CODES) {
        expect(uploadIssueText(video({ processingIssue: { kind: 'encode_failed', reason: 'raw', code } }), issue)).toBe(issue[code]);
      }
      expect(uploadIssueText(video({ processingIssue: { kind: 'needs_reupload', reason: 'raw' } }), issue)).toBe(issue.needs_reupload);
      expect(uploadIssueText(video({ processingIssue: { kind: 'encode_failed', code: 'new' as never } }), issue)).toBe(issue.encode_failed);
      expect(uploadIssueText(video({ processingIssue: { kind: 'needs_reupload', code: 'stalled' as never } }), issue)).toBe(issue.needs_reupload);
      expect(uploadIssueText(video({ processingIssue: { kind: 'new' as never } }), issue)).toBeNull();
      expect(uploadIssueText(video({ processingIssue: { kind: 'stalled' } }), issue)).toBeNull();
      expect(uploadIssueText(video({}), issue)).toBeNull();
    }
    expect(Object.values(AR_TRANSLATIONS.upload.issue).join(' ')).not.toMatch(/[a-z]|فيديو/i);
  });

  it('a file that arrived changed is sent again by the team', () => {
    expect(canReupload(video({ processingIssue: { kind: 'needs_reupload', code: 'source_changed' } }))).toBe(false);
    expect(canReupload(video({ processingIssue: { kind: 'encode_failed', code: 'audio_only' } }))).toBe(true);
    expect(canReupload(video({}))).toBe(true);
  });
});
