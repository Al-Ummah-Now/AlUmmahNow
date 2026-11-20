/**
 * A count with its noun: "1 view", "12 comments", «٣ تعليقات», «١٤ إعجابًا», «مرئيان».
 *
 * One place for every app (web, admin) so Arabic number agreement is written once. Arabic
 * follows the CLDR plural category of the real count: one and two are words of their own
 * («مشاهدة واحدة», «مشاهدتان»), 3–10 take the plural, 11–99 the accusative singular, 100+ the
 * genitive singular. A compact count of 1,000 or more takes the singular noun after its scale
 * word, and exactly one or two has no digit: «ألف مشاهدة», «ألفا مشاهدة», «٣ آلاف مشاهدة»,
 * «١٫٣ ألف مشاهدة», «١٫٢ مليون مشاهدة» (owner's final rule 2026-11-20; see formatCompact). Zero is a phrase («لا توجد تعليقات»), never «٠ تعليق».
 * Every noun has its dual («تعليقان», «مساران صوتيان»). apps/web's videoMeta and admin-web's
 * formatCount both call this; add a noun here rather than writing another helper.
 */
import { formatCompact, formatInteger, formatNumber, pluralCategory, type FormatLocale } from './locale-format';

export type CountNoun = 'view' | 'subscriber' | 'video' | 'like' | 'comment' | 'message' | 'audioTrack' | 'user' | 'viewer' | 'character' | 'image' | 'day' | 'hour' | 'minute' | 'reply';

type ArabicForms = { zero: string; one: string; two: string; few: string; many: string; other: string };

const AR: Record<CountNoun, ArabicForms> = {
  view: { zero: 'لا توجد مشاهدات', one: 'مشاهدة واحدة', two: 'مشاهدتان', few: 'مشاهدات', many: 'مشاهدة', other: 'مشاهدة' },
  subscriber: { zero: 'لا يوجد مشتركون', one: 'مشترك واحد', two: 'مشتركان', few: 'مشتركين', many: 'مشتركًا', other: 'مشترك' },
  video: { zero: 'لا توجد مرئيات', one: 'مرئي واحد', two: 'مرئيان', few: 'مرئيات', many: 'مرئيًا', other: 'مرئي' },
  like: { zero: 'لا توجد إعجابات', one: 'إعجاب واحد', two: 'إعجابان', few: 'إعجابات', many: 'إعجابًا', other: 'إعجاب' },
  comment: { zero: 'لا توجد تعليقات', one: 'تعليق واحد', two: 'تعليقان', few: 'تعليقات', many: 'تعليقًا', other: 'تعليق' },
  message: { zero: 'لا توجد رسائل', one: 'رسالة واحدة', two: 'رسالتان', few: 'رسائل', many: 'رسالة', other: 'رسالة' },
  audioTrack: { zero: 'لا توجد مسارات صوتية', one: 'مسار صوتي واحد', two: 'مساران صوتيان', few: 'مسارات صوتية', many: 'مسارًا صوتيًا', other: 'مسار صوتي' },
  user: { zero: 'لا مستخدمين', one: 'مستخدم واحد', two: 'مستخدمان', few: 'مستخدمين', many: 'مستخدمًا', other: 'مستخدم' },
  viewer: { zero: 'لا يوجد مشاهدون', one: 'مشاهد واحد', two: 'مشاهدان', few: 'مشاهدين', many: 'مشاهدًا', other: 'مشاهد' },
  character: { zero: 'لا أحرف', one: 'حرف واحد', two: 'حرفان', few: 'أحرف', many: 'حرفًا', other: 'حرف' },
  image: { zero: 'لا توجد صور', one: 'صورة واحدة', two: 'صورتان', few: 'صور', many: 'صورة', other: 'صورة' },
  day: { zero: 'لا أيام', one: 'يوم واحد', two: 'يومان', few: 'أيام', many: 'يومًا', other: 'يوم' },
  hour: { zero: 'لا ساعات', one: 'ساعة واحدة', two: 'ساعتان', few: 'ساعات', many: 'ساعة', other: 'ساعة' },
  minute: { zero: 'لا دقائق', one: 'دقيقة واحدة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة', other: 'دقيقة' },
  reply: { zero: 'لا توجد ردود', one: 'رد واحد', two: 'ردّان', few: 'ردود', many: 'ردًا', other: 'رد' },
};

const EN: Record<CountNoun, { zero: string; one: string; other: string }> = {
  view: { zero: 'No views', one: 'view', other: 'views' },
  subscriber: { zero: 'No subscribers', one: 'subscriber', other: 'subscribers' },
  video: { zero: 'No videos', one: 'video', other: 'videos' },
  like: { zero: 'No likes', one: 'like', other: 'likes' },
  comment: { zero: 'No comments', one: 'comment', other: 'comments' },
  message: { zero: 'No messages', one: 'message', other: 'messages' },
  audioTrack: { zero: 'No audio tracks', one: 'audio track', other: 'audio tracks' },
  user: { zero: 'No users', one: 'user', other: 'users' },
  viewer: { zero: 'No viewers', one: 'viewer', other: 'viewers' },
  character: { zero: 'No characters', one: 'character', other: 'characters' },
  image: { zero: 'No images', one: 'image', other: 'images' },
  day: { zero: 'No days', one: 'day', other: 'days' },
  hour: { zero: 'No hours', one: 'hour', other: 'hours' },
  minute: { zero: 'No minutes', one: 'minute', other: 'minutes' },
  reply: { zero: 'No replies', one: 'reply', other: 'replies' },
};

/** True when a compact number carries a scale word («٤٨٫٢ ألف», «١٫٢ مليون»): any character that is not a digit, a separator or a direction mark. */
export function hasScaleWord(shown: string): boolean {
  return /[^\d٠-٩٫٬.,\s‏؜]/.test(shown);
}

export interface CountNounOptions {
  /** "1.2K" / «١٫٢ ألف» instead of the exact, grouped number */
  compact?: boolean;
  /** Between the number and the noun; a no-break space keeps them on one line. Default a space. */
  joiner?: string;
  /** Zero as a number with the noun («٠ ساعة», "0 hours") instead of the zero phrase. */
  zeroAsNumber?: boolean;
}

/** A count with its noun in the locale's language and digits; see the module note. */
export function formatCountNoun(locale: FormatLocale, count: number | string | null | undefined, noun: CountNoun, options: CountNounOptions = {}): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const join = options.joiner ?? ' ';
  const shown = options.compact ? formatCompact(locale, n) : formatInteger(locale, n);
  if (String(locale).toLowerCase().startsWith('ar')) {
    const forms = AR[noun];
    if (n === 0) return options.zeroAsNumber ? `${shown}${join}${forms.other}` : forms.zero;
    // 1,000+: the scale word (construct form for two) then the singular noun.
    if (options.compact && n >= 1000) return `${formatCompact(locale, n, 1, { beforeNoun: true })}${join}${forms.other}`;
    const category = pluralCategory(locale, n);
    if (category === 'one') return forms.one;
    if (category === 'two') return forms.two;
    return `${shown}${join}${category === 'few' ? forms.few : category === 'many' ? forms.many : forms.other}`;
  }
  const forms = EN[noun];
  if (n === 0) return options.zeroAsNumber ? `${shown}${join}${forms.other}` : forms.zero;
  return n === 1 ? `${formatNumber(locale, 1)}${join}${forms.one}` : `${shown}${join}${forms.other}`;
}
