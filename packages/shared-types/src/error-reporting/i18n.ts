/**
 * Friendly error copy (en/ar) for the web and admin-web error screens. Kept
 * here, not in the translations API, because an error screen must render
 * when everything else (API, providers, the root layout) has failed.
 */
import { isChunkLoadError, isNetworkError, isVersionSkewError } from './classify';

export type FriendlyErrorKind = 'generic' | 'offline' | 'update' | 'session' | 'server' | 'notFound';

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
      notFound: { title: 'Page not found', body: 'The page you are looking for does not exist or has moved.' },
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
      notFound: { title: 'الصفحة غير موجودة', body: 'الصفحة التي تبحث عنها غير موجودة أو نُقلت.' },
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
  if (opts.digest || (opts.status && opts.status >= 500)) return 'server';
  return 'generic';
}

export function errorScreenStrings(locale: string | undefined): ErrorScreenStrings {
  return locale === 'ar' ? ERROR_SCREEN_STRINGS.ar : ERROR_SCREEN_STRINGS.en;
}
