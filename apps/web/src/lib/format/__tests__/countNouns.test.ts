/**
 * The shared count formatter (@al-ummah/shared-types formatCountNoun) that videoMeta and the
 * admin use: Arabic number agreement, duals, the zero phrase, and the singular after a scale word.
 */
import { formatCountNoun, type CountNoun } from '@al-ummah/shared-types';

const sp = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatCountNoun', () => {
  it('Arabic follows the count: zero phrase, one and two as words, plural 3–10, accusative 11–99, singular 100+', () => {
    expect([0, 1, 2, 3, 10, 11, 14, 99, 100, 102, 1520].map((n) => formatCountNoun('ar', n, 'comment'))).toEqual([
      'لا توجد تعليقات', 'تعليق واحد', 'تعليقان', '٣ تعليقات', '١٠ تعليقات', '١١ تعليقًا', '١٤ تعليقًا', '٩٩ تعليقًا', '١٠٠ تعليق', '١٠٢ تعليق', '١٬٥٢٠ تعليقًا',
    ]);
  });

  it('every noun has a zero phrase, a one, a dual and the plural forms', () => {
    const table: Record<CountNoun, string[]> = {
      view: ['لا توجد مشاهدات', 'مشاهدة واحدة', 'مشاهدتان', '٣ مشاهدات', '١٤ مشاهدة'],
      subscriber: ['لا يوجد مشتركون', 'مشترك واحد', 'مشتركان', '٣ مشتركين', '١٤ مشتركًا'],
      newSubscriber: ['لا يوجد مشتركون جدد', 'مشترك جديد واحد', 'مشتركان جديدان', '٣ مشتركين جدد', '١٤ مشتركًا جديدًا'],
      video: ['لا توجد مرئيات', 'مرئي واحد', 'مرئيان', '٣ مرئيات', '١٤ مرئيًا'],
      like: ['لا توجد إعجابات', 'إعجاب واحد', 'إعجابان', '٣ إعجابات', '١٤ إعجابًا'],
      comment: ['لا توجد تعليقات', 'تعليق واحد', 'تعليقان', '٣ تعليقات', '١٤ تعليقًا'],
      message: ['لا توجد رسائل', 'رسالة واحدة', 'رسالتان', '٣ رسائل', '١٤ رسالة'],
      audioTrack: ['لا توجد مسارات صوتية', 'مسار صوتي واحد', 'مساران صوتيان', '٣ مسارات صوتية', '١٤ مسارًا صوتيًا'],
    };
    for (const [noun, forms] of Object.entries(table)) {
      expect([0, 1, 2, 3, 14].map((n) => formatCountNoun('ar', n, noun as CountNoun))).toEqual(forms);
    }
  });

  it('a compact number with a scale word takes the singular (#1564)', () => {
    expect(sp(formatCountNoun('ar', 48203, 'view', { compact: true }))).toBe('٤٨٫٢ ألف مشاهدة');
    expect(sp(formatCountNoun('ar', 1520, 'video', { compact: true }))).toBe('١٫٥ ألف مرئي');
  });

  it('English: "No …", "1 …", then the plural; compact on request', () => {
    expect([0, 1, 12840].map((n) => formatCountNoun('en', n, 'like'))).toEqual(['No likes', '1 like', '12,840 likes']);
    expect(formatCountNoun('en', 2, 'audioTrack')).toBe('2 audio tracks');
    expect(formatCountNoun('en', 1500, 'view', { compact: true })).toBe('1.5K views');
  });

  it('the joiner keeps the number with its noun when asked (admin lists)', () => {
    expect(formatCountNoun('ar', 3, 'comment', { joiner: ' ' })).toBe('٣ تعليقات');
  });

  it('Studio counts (Dashboard latest video, audio-track quota): 10 and 100+ forms and English singulars', () => {
    expect(formatCountNoun('ar', 10, 'audioTrack')).toBe('١٠ مسارات صوتية');
    expect(formatCountNoun('ar', 100, 'audioTrack')).toBe('١٠٠ مسار صوتي');
    expect(formatCountNoun('ar', 9, 'comment')).toBe('٩ تعليقات');
    expect(formatCountNoun('ar', 11, 'like')).toBe('١١ إعجابًا');
    expect(formatCountNoun('ar', 100, 'like')).toBe('١٠٠ إعجاب');
    expect(formatCountNoun('en', 1, 'audioTrack')).toBe('1 audio track');
    expect(formatCountNoun('en', 1, 'comment')).toBe('1 comment');
  });

  it('new subscribers (analytics chart) in English: "No new subscribers", "1 new subscriber", plural', () => {
    expect([0, 1, 5].map((n) => formatCountNoun('en', n, 'newSubscriber'))).toEqual(['No new subscribers', '1 new subscriber', '5 new subscribers']);
  });

  it('treats missing, invalid and negative counts as zero', () => {
    expect(formatCountNoun('en', undefined, 'view')).toBe('No views');
    expect(formatCountNoun('ar', 'x', 'video')).toBe('لا توجد مرئيات');
    expect(formatCountNoun('en', -4, 'comment')).toBe('No comments');
  });
});
