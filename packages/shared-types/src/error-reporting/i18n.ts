/**
 * Friendly error copy (en/ar) for the web and admin-web error screens. Kept
 * here, not in the translations API, because an error screen must render
 * when everything else (API, providers, the root layout) has failed.
 *
 * The same words, in the same card, on every app (wiki guides/error-pages.md):
 * www, scholar sites, the dev site, Auth and the CMS keep a copy of these
 * strings in their own i18n files.
 */
import { isChunkLoadError, isNetworkError, isVersionSkewError } from './classify';
import { numberFormat } from '../locale-format';

export type FriendlyErrorKind = 'generic' | 'offline' | 'update' | 'session' | 'server' | 'notFound' | 'gone';

export interface FriendlyErrorCopy {
  title: string;
  body: string;
}

export interface ErrorScreenStrings {
  kinds: Record<FriendlyErrorKind, FriendlyErrorCopy>;
  tryAgain: string;
  reload: string;
  goHome: string;
  signIn: string;
  contactUs: string;
  reference: string;
  referenceHint: string;
  copy: string;
  copied: string;
  needHelp: string;
  goBack: string;
  search: string;
  /** The search field's label (visually hidden) */
  searchLabel: string;
  searchPlaceholder: string;
  /** "Error {code}" above the title */
  errorCode: string;
  uploadWait: string;
  updateNow: string;
  updateLater: string;
  updateNotice: string;
}

export const ERROR_SCREEN_STRINGS: Record<'en' | 'ar', ErrorScreenStrings> = {
  en: {
    kinds: {
      generic: { title: 'Something went wrong', body: 'This part of the page ran into a problem. Try again, and if it keeps happening, let us know.' },
      offline: { title: 'You seem to be offline', body: 'We could not reach Al Ummah Now. Check your connection, then try again.' },
      update: { title: 'A new version is available', body: 'The site was updated while this page was open. Reload to continue with the latest version.' },
      session: { title: 'Please sign in again', body: 'Your session has ended. Sign in again to pick up where you left off.' },
      server: { title: 'We could not load this page', body: 'Our server had a problem with this request. It has been reported. Please try again in a moment.' },
      notFound: { title: 'Page not found', body: "We couldn't find this page. The link may be wrong, or the page may have moved." },
      gone: { title: 'This was removed', body: "It's no longer on Al Ummah Now. Search for something else, or go to the home page." },
    },
    tryAgain: 'Try again',
    reload: 'Reload page',
    goHome: 'Go to home',
    signIn: 'Sign in again',
    contactUs: 'Contact us',
    reference: 'Reference',
    referenceHint: 'Quote this reference if you contact us, so we can find what happened.',
    copy: 'Copy reference',
    copied: 'Copied',
    needHelp: 'Still stuck?',
    goBack: 'Go back',
    search: 'Search',
    searchLabel: 'Search Al Ummah Now',
    searchPlaceholder: 'Search videos, channels and posts',
    errorCode: 'Error {code}',
    uploadWait: 'Your upload is still in progress. The page will update when it finishes.',
    updateNow: 'Reload now',
    updateLater: 'Later',
    updateNotice: 'A new version of the site is available.',
  },
  ar: {
    kinds: {
      generic: { title: 'حدث خطأ ما', body: 'واجه هذا الجزء من الصفحة مشكلة. حاول مرة أخرى، وإن تكررت المشكلة فأخبرنا.' },
      offline: { title: 'يبدو أنك غير متصل بالإنترنت', body: 'تعذّر الوصول إلى الأمة الآن. تحقّق من اتصالك ثم حاول مرة أخرى.' },
      update: { title: 'يتوفر إصدار جديد', body: 'جرى تحديث الموقع أثناء فتح هذه الصفحة. أعد تحميلها لتتابع على أحدث إصدار.' },
      session: { title: 'يُرجى تسجيل الدخول مرة أخرى', body: 'انتهت جلستك. سجّل الدخول مرة أخرى لتتابع من حيث توقفت.' },
      server: { title: 'تعذّر تحميل هذه الصفحة', body: 'واجه الخادم مشكلة في هذا الطلب، وقد أُبلغ عنها. يُرجى المحاولة بعد قليل.' },
      notFound: { title: 'الصفحة غير موجودة', body: 'لم نعثر على هذه الصفحة. ربما الرابط غير صحيح أو نُقلت الصفحة.' },
      gone: { title: 'حُذف هذا المحتوى', body: 'لم يعد موجودًا على الأمة الآن. ابحث عن شيء آخر أو انتقل إلى الصفحة الرئيسية.' },
    },
    tryAgain: 'حاول مرة أخرى',
    reload: 'أعد تحميل الصفحة',
    goHome: 'الصفحة الرئيسية',
    signIn: 'سجّل الدخول مرة أخرى',
    contactUs: 'تواصل معنا',
    reference: 'الرقم المرجعي',
    referenceHint: 'اذكر هذا الرقم المرجعي عند التواصل معنا لنعرف ما حدث.',
    copy: 'انسخ الرقم المرجعي',
    copied: 'نُسخ',
    needHelp: 'ما زلت تواجه المشكلة؟',
    goBack: 'رجوع',
    search: 'بحث',
    searchLabel: 'ابحث في الأمة الآن',
    searchPlaceholder: 'ابحث في المرئيات والقنوات والمنشورات',
    errorCode: 'خطأ {code}',
    uploadWait: 'ما زال الرفع جارياً. ستُحدَّث الصفحة عند اكتماله.',
    updateNow: 'أعد التحميل الآن',
    updateLater: 'لاحقاً',
    updateNotice: 'يتوفر إصدار جديد من الموقع.',
  },
};

/** Which friendly screen fits an error. */
export function friendlyErrorKind(error: unknown, opts: { online?: boolean; digest?: string; status?: number } = {}): FriendlyErrorKind {
  if (isVersionSkewError(error) || isChunkLoadError(error)) return 'update';
  if (opts.online === false || isNetworkError(error)) return 'offline';
  if (opts.status === 401) return 'session';
  if (opts.status === 404) return 'notFound';
  if (opts.status === 410) return 'gone';
  if (opts.digest || (opts.status && opts.status >= 500)) return 'server';
  return 'generic';
}

export function errorScreenStrings(locale: string | undefined): ErrorScreenStrings {
  return locale === 'ar' ? ERROR_SCREEN_STRINGS.ar : ERROR_SCREEN_STRINGS.en;
}

/** "Error 404" / «خطأ ٤٠٤» (Eastern Arabic digits in Arabic, no grouping). */
export function errorCodeLabel(locale: string | undefined, code: number): string {
  return errorScreenStrings(locale).errorCode.replace('{code}', numberFormat(locale ?? 'en', { useGrouping: false }).format(code));
}

/** The HTTP status each screen stands for (the code line); none for the client-only screens. */
export const ERROR_KIND_STATUS: Partial<Record<FriendlyErrorKind, number>> = { notFound: 404, gone: 410, server: 500 };

export type ErrorPageIcon = 'notFound' | 'gone' | 'alert' | 'offline' | 'update' | 'session' | 'search' | 'back' | 'home' | 'retry' | 'copy';

/**
 * The error card's icons (lucide shapes, 24×24, stroke currentColor), drawn from these strings in
 * every app so they look the same everywhere (lucide versions differ between repos).
 */
export const ERROR_PAGE_ICONS: Record<ErrorPageIcon, string> = {
  notFound: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
  gone: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  offline: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  update: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  session: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  retry: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};

/** The badge icon for a screen. */
export function errorKindIcon(kind: FriendlyErrorKind): ErrorPageIcon {
  if (kind === 'notFound' || kind === 'gone' || kind === 'offline' || kind === 'update' || kind === 'session') return kind;
  return 'alert';
}
