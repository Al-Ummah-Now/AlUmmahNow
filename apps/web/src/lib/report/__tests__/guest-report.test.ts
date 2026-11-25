import { AR_TRANSLATIONS } from '@/lib/i18n/translations/ar';
import { EN_TRANSLATIONS } from '@/lib/i18n/translations/en';
import { GUEST_REPORT_COPY, hasGuestReportTarget, parseGuestReportParams, resolveManualReportTarget, resolveReportSubmissionTarget } from '../guest-report';

const params = (q: string) => parseGuestReportParams(new URLSearchParams(q));
const manual = (input: string, type: 'video' | 'channel' | 'comment' = 'video') => {
  const r = resolveManualReportTarget(type, input);
  return r.ok ? [r.entityType, r.entityId, ...(r.entityParentId ? [r.entityParentId] : [])] : r.error;
};

describe('the report page target', () => {
  it('takes the apps query: type, id, stream, message', () => {
    const submit = (q: string) => {
      const r = resolveReportSubmissionTarget(params(q), 'video', '');
      return r.ok ? [r.entityType, r.entityId, r.entityParentId] : r.error;
    };
    expect(submit('type=video&id=vid-1')).toEqual(['video', 'vid-1', undefined]);
    expect(submit('type=live&id=live-1')).toEqual(['livestream', 'live-1', undefined]);
    expect(submit('type=livestream&id=live-1')).toEqual(['livestream', 'live-1', undefined]);
    expect(submit('type=channel&id=@handle')).toEqual(['channel', '@handle', undefined]);
    expect(submit('type=comment&id=cmt-1')).toEqual(['comment', 'cmt-1', undefined]);
    expect(submit('type=post&id=post-1')).toEqual(['post', 'post-1', undefined]);
    expect(submit('type=live_chat&stream=live-1&message=msg-1')).toEqual(['live_chat', 'msg-1', 'live-1']);
    expect(submit('type=live_chat&stream=live-1')).toEqual(['livestream', 'live-1', undefined]);
    expect(submit('type=video&id=a%20b')).toBe('invalidId');
    expect(params('type=playlist&id=x').unknownType).toBe(true);
    expect(hasGuestReportTarget(params('type=video'))).toBe(false);
  });

  it('reads our links with the intake parser', () => {
    const site = 'https://videos.alummahnow.net';
    const cases: Array<[string, unknown]> = [
      [`${site}/en/video/vid-synth-01?t=3`, ['video', 'vid-synth-01']],
      [`${site}/ar/shorts/vid-synth-01`, ['video', 'vid-synth-01']],
      ['videos.alummahnow.net/embed/v/vid-synth-01', ['video', 'vid-synth-01']],
      [`${site}/en/live/live-synth-01`, ['livestream', 'live-synth-01']],
      [`${site}/en/post/post-synth-01`, ['post', 'post-synth-01']],
      [`${site}/channels/chan-synth-01?post=post-synth-01`, ['post', 'post-synth-01', 'chan-synth-01']],
      [`${site}/en/channels/chan-synth-01`, ['channel', 'chan-synth-01']],
      [`${site}/en/@synthetic?tab=videos`, ['channel', '@synthetic']],
      [`${site}/c/synthetic`, ['channel', '@synthetic']],
      [`${site}/en/@synthetic?post=post-synth-01`, ['post', 'post-synth-01']],
      ['https://alummahnow.link/v/vid-synth-01', ['video', 'vid-synth-01']],
      ['alummahnow.link/@synthetic', ['channel', '@synthetic']],
      ['https://alummahnow.link/e/live-synth-01', ['livestream', 'live-synth-01']],
      ['https://scholar.alummahnow.org/en/watch/vid-synth-01', ['video', 'vid-synth-01']],
    ];
    for (const [url, expected] of cases) expect([url, manual(url)]).toEqual([url, expected]);
  });

  it("a comment's link is the comment, never what it is on", () => {
    const site = 'https://videos.alummahnow.net';
    expect(manual(`${site}/en/video/vid-synth-01?comment=cmt-synth-01`)).toEqual(['comment', 'cmt-synth-01', 'vid-synth-01']);
    expect(manual(`${site}/en/post/post-synth-01#comment-cmt-synth-01`)).toEqual(['comment', 'cmt-synth-01', 'post-synth-01']);
    for (const path of ['/en/video/vid-synth-01#comments', '/en/video/vid-synth-01/comments/x', '/en/live/live-synth-01?message=m', '/en/@synthetic?comment=cmt-synth-01', '/en/@synthetic#comment-x']) expect([path, manual(site + path)]).toEqual([path, 'unsupportedUrl']);
  });

  it('refuses other sites, look-alikes and pages of several items, and ids that cannot be ours', () => {
    for (const url of ['https://example.org/video/vid-synth-01', 'https://videos.alummahnow.net.example.org/en/video/vid-synth-01', 'https://user@videos.alummahnow.net/en/video/vid-synth-01', 'https://admin.alummahnow.net/moderation', 'http://localhost/en/video/vid-synth-01', 'javascript://alummahnow.net/x', 'https://videos.alummahnow.net/', 'https://videos.alummahnow.net/en/playlist/pl-synth-01', 'https://videos.alummahnow.net/en/video?vid=a&vid=b', 'ftp://videos.alummahnow.net/en/video/vid-synth-01']) expect([url, manual(url)]).toEqual([url, 'unsupportedUrl']);
    expect(manual('   ')).toBe('required');
    for (const id of ['index:recent-videos', '../x', 'a b', '@x', '@handle']) expect([id, manual(id)]).toEqual([id, 'invalidId']);
    expect(manual('@synthetic', 'channel')).toEqual(['channel', '@synthetic']);
    expect(manual('vid-synth-01')).toEqual(['video', 'vid-synth-01']);
  });

  it('promises what the signed-in report dialog does, in the same words', () => {
    for (const [copy, t] of [[GUEST_REPORT_COPY.en, EN_TRANSLATIONS], [GUEST_REPORT_COPY.ar, AR_TRANSLATIONS]] as const) {
      const sentence = t.reportContent.reviewNotice.split('. ')[0];
      expect(sentence).toMatch(/24-48|٢٤ إلى ٤٨/);
      expect(copy.aside.review.startsWith(`${sentence}. `)).toBe(true);
    }
  });

  it('says the same in both languages, with nothing we do not do', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v).map((x) => `${k}.${x}`) : [k]));
    expect(keys(GUEST_REPORT_COPY.ar)).toEqual(keys(GUEST_REPORT_COPY.en));
    const ar = JSON.stringify(GUEST_REPORT_COPY.ar);
    expect(ar).not.toMatch(/CSAM|فيديو|[0-9],|,\s/);
    expect(JSON.stringify(GUEST_REPORT_COPY.en)).not.toMatch(/preserv|one year|CSAM/i);
  });
});
