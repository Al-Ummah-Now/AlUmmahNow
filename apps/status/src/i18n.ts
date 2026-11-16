/** Public status page text, en + ar. Status and component names come from @al-ummah/shared-types. */
import {
  STATUS_COMPONENTS,
  STATUS_CONFIRM_DAYS,
  STATUS_LABELS,
  fillTemplate,
  formatDate,
  formatDateTime,
  formatPercent as sharedPercent,
  type ComponentState,
  type IncidentStatus,
  type TemplateParams,
} from '@al-ummah/shared-types';
import { HISTORY_DAYS, UPTIME_DAYS } from './model';
import { CONFIRM_COOLDOWN_MINUTES } from './subscribe';

export type Locale = 'en' | 'ar';

const en = {
  title: 'Status',
  pageTitle: 'Al Ummah Now status',
  description: 'Live status of Al Ummah Now: the website, videos, sign-in, uploads, playback and more.',
  skip: 'Skip to content',
  overall_operational: 'All systems operational',
  overall_maintenance: 'Maintenance in progress',
  overall_degraded: 'Some systems are slow',
  overall_partial: 'Some systems are having problems',
  overall_major: 'Major outage',
  lastChecked: 'Last checked {time}',
  noData: 'Waiting for the first checks',
  components: 'Components',
  uptimeTitle: 'Uptime over the last {uptimeDays} days',
  uptimeValue: '{value} uptime',
  uptimeNone: 'No data yet',
  daysAgo: '{uptimeDays} days ago',
  daysAgo30: '{midDays} days ago',
  today: 'Today',
  dayNoData: '{day}: no data',
  dayUptime: '{day}: {state}, {value} uptime',
  dayState: '{day}: {state}',
  active: 'Active incidents',
  maintenanceNow: 'Maintenance in progress',
  upcoming: 'Scheduled maintenance',
  history: 'Past incidents',
  historyNone: 'No incidents in the last {historyDays} days.',
  affected: 'Affected: {list}',
  window: '{from} to {to}',
  from: 'From {from}',
  updatedAt: 'Updated {time}',
  postedAt: 'Posted {time}',
  resolvedAt: 'Resolved {time}',
  readMore: 'Details',
  back: 'Back to status',
  feeds: 'Follow updates',
  atom: 'Atom feed',
  rss: 'RSS feed',
  json: 'JSON',
  footerNote: 'This page runs separately from the services it watches, so it stays up when they are down.',
  notFound: 'Incident not found',
  notFoundBody: 'It may have been removed.',
  incident: 'Incident',
  maintenance: 'Maintenance',
  emailUpdates: 'Email updates',
  subscribeTitle: 'Get status updates by email',
  subscribeIntro: 'We email you when an incident or scheduled maintenance is posted on this page, and with each update until it is resolved.',
  subscribeEmail: 'Email address',
  subscribeLanguage: 'Language of the emails',
  subscribeButton: 'Subscribe',
  subscribeNote: 'We send a confirmation email first. Every email has a link to unsubscribe.',
  subscribeInvalid: 'Enter a valid email address, like name@example.com',
  subscribeLimited: 'Too many requests from your connection. Try again in an hour.',
  subscribeUnavailable: 'We could not send the confirmation email right now. Try again in a few minutes.',
  subscribeErrorTitle: 'There is a problem',
  honeypot: 'Leave this field empty',
  sentTitle: 'Check your inbox',
  sentBody: 'We sent you a confirmation link. Your subscription starts once you open it and confirm. The link works for {confirmDays} days.',
  sentSpam: 'Nothing arrived? Check your spam folder, or subscribe again in {cooldownMinutes} minutes.',
  confirmTitle: 'Confirm your subscription',
  confirmBody: 'Confirm to get Al Ummah Now status updates by email.',
  confirmButton: 'Confirm subscription',
  expiredTitle: 'This link has expired',
  expiredBody: 'Confirmation links work for {confirmDays} days and stop working once you unsubscribe. Subscribe again to get a new one.',
  expiredBodyOff: 'Confirmation links work for {confirmDays} days and stop working once you unsubscribe.',
  subscribeAgain: 'Subscribe again',
  subscribedTitle: 'You are subscribed',
  subscribedBody: 'We will email you when an incident or maintenance is posted, and with its updates. Every email has a link to unsubscribe.',
  unsubscribeTitle: 'Unsubscribe from status emails',
  unsubscribeBody: 'You will stop getting Al Ummah Now status updates by email, and we will delete your address.',
  unsubscribeButton: 'Unsubscribe',
  unsubscribedTitle: 'You are unsubscribed',
  unsubscribedBody: 'We will not email you status updates any more, and your address is deleted.',
  ctaTitle: 'Follow incidents by email',
  ctaBody: 'Get an email when an incident or maintenance is posted, and with each update.',
  ctaButton: 'Get email updates',
} as const;

type Messages = Record<keyof typeof en, string>;

const ar: Messages = {
  title: 'الحالة',
  pageTitle: 'حالة خدمات الأمة الآن',
  description: 'الحالة المباشرة لخدمات الأمة الآن: الموقع والمرئيات وتسجيل الدخول والرفع والتشغيل وغيرها.',
  skip: 'انتقل إلى المحتوى',
  overall_operational: 'جميع الخدمات تعمل',
  overall_maintenance: 'صيانة جارية',
  overall_degraded: 'بعض الخدمات بطيئة',
  overall_partial: 'بعض الخدمات تواجه مشكلات',
  overall_major: 'انقطاع كبير',
  lastChecked: 'آخر فحص {time}',
  noData: 'بانتظار أول فحص',
  components: 'الخدمات',
  uptimeTitle: 'نسبة التشغيل خلال آخر {uptimeDays} يومًا',
  uptimeValue: 'نسبة التشغيل {value}',
  uptimeNone: 'لا توجد بيانات بعد',
  daysAgo: 'قبل {uptimeDays} يومًا',
  daysAgo30: 'قبل {midDays} يومًا',
  today: 'اليوم',
  dayNoData: '{day}: لا توجد بيانات',
  dayUptime: '{day}: {state}، نسبة التشغيل {value}',
  dayState: '{day}: {state}',
  active: 'حوادث جارية',
  maintenanceNow: 'صيانة جارية',
  upcoming: 'صيانة مجدولة',
  history: 'الحوادث السابقة',
  historyNone: 'لا حوادث خلال آخر {historyDays} يومًا.',
  affected: 'الخدمات المتأثرة: {list}',
  window: 'من {from} إلى {to}',
  from: 'ابتداءً من {from}',
  updatedAt: 'حُدّث {time}',
  postedAt: 'نُشر {time}',
  resolvedAt: 'حُلّ {time}',
  readMore: 'التفاصيل',
  back: 'العودة إلى الحالة',
  feeds: 'تابع التحديثات',
  atom: 'موجز Atom',
  rss: 'موجز RSS',
  json: 'JSON',
  footerNote: 'تعمل هذه الصفحة بمعزل عن الخدمات التي تراقبها، فتبقى متاحة حين تتعطل.',
  notFound: 'الحادثة غير موجودة',
  notFoundBody: 'ربما حُذفت.',
  incident: 'حادثة',
  maintenance: 'صيانة',
  emailUpdates: 'التحديثات بالبريد',
  subscribeTitle: 'تابع حالة الخدمات بالبريد الإلكتروني',
  subscribeIntro: 'نراسلك حين تُنشر على هذه الصفحة حادثة أو صيانة مجدولة، ومع كل تحديث لها حتى تُحلّ.',
  subscribeEmail: 'البريد الإلكتروني',
  subscribeLanguage: 'لغة الرسائل',
  subscribeButton: 'اشترك',
  subscribeNote: 'نرسل إليك رسالة تأكيد أولًا، وفي كل رسالة رابط لإلغاء الاشتراك.',
  subscribeInvalid: 'أدخل بريدًا إلكترونيًا صحيحًا، مثل name@example.com',
  subscribeLimited: 'طلبات كثيرة من اتصالك. حاول مجددًا بعد ساعة.',
  subscribeUnavailable: 'تعذّر إرسال رسالة التأكيد الآن. حاول مجددًا بعد دقائق.',
  subscribeErrorTitle: 'هناك مشكلة',
  honeypot: 'اترك هذا الحقل فارغًا',
  sentTitle: 'تفقّد بريدك',
  sentBody: 'أرسلنا إليك رابط تأكيد. يبدأ اشتراكك حين تفتحه وتؤكّده. يعمل الرابط {confirmDays} أيام.',
  sentSpam: 'لم تصلك الرسالة؟ تفقّد مجلد الرسائل غير المرغوب فيها، أو اشترك مجددًا بعد {cooldownMinutes} دقائق.',
  confirmTitle: 'أكّد اشتراكك',
  confirmBody: 'أكّد لتصلك تحديثات حالة خدمات الأمة الآن بالبريد الإلكتروني.',
  confirmButton: 'تأكيد الاشتراك',
  expiredTitle: 'انتهت صلاحية هذا الرابط',
  expiredBody: 'تعمل روابط التأكيد {confirmDays} أيام، وتتوقف حين تلغي اشتراكك. اشترك مجددًا لتصلك رسالة جديدة.',
  expiredBodyOff: 'تعمل روابط التأكيد {confirmDays} أيام، وتتوقف حين تلغي اشتراكك.',
  subscribeAgain: 'اشترك مجددًا',
  subscribedTitle: 'تم اشتراكك',
  subscribedBody: 'سنراسلك حين تُنشر حادثة أو صيانة، ومع تحديثاتها. وفي كل رسالة رابط لإلغاء الاشتراك.',
  unsubscribeTitle: 'إلغاء الاشتراك في رسائل الحالة',
  unsubscribeBody: 'لن تصلك بعد الآن تحديثات حالة خدمات الأمة الآن بالبريد، وسنحذف بريدك.',
  unsubscribeButton: 'إلغاء الاشتراك',
  unsubscribedTitle: 'أُلغي اشتراكك',
  unsubscribedBody: 'لن نراسلك بتحديثات الحالة بعد الآن، وقد حُذف بريدك.',
  ctaTitle: 'تابع الحوادث بالبريد',
  ctaBody: 'تصلك رسالة حين تُنشر حادثة أو صيانة، ومع كل تحديث لها.',
  ctaButton: 'اشترك في التحديثات بالبريد',
};

const MESSAGES: Record<Locale, Messages> = { en, ar };

export type MessageKey = keyof typeof en;

/** Numbers the copy mentions, filled in the reader's digits (Arabic ٠–٩, English 0–9). */
const COPY_NUMBERS = {
  uptimeDays: UPTIME_DAYS,
  midDays: 30,
  historyDays: HISTORY_DAYS,
  confirmDays: STATUS_CONFIRM_DAYS,
  cooldownMinutes: CONFIRM_COOLDOWN_MINUTES,
};

export function t(locale: Locale, key: MessageKey, vars: TemplateParams = {}): string {
  return fillTemplate(locale, MESSAGES[locale][key], { ...COPY_NUMBERS, ...vars });
}

export function stateLabel(locale: Locale, s: ComponentState | IncidentStatus | 'none'): string {
  return STATUS_LABELS[s][locale];
}

export function componentName(locale: Locale, id: string): string {
  return STATUS_COMPONENTS.find((c) => c.id === id)?.[locale] ?? id;
}

/** English dates read the British way («15 Nov 2026, 14:05»); Arabic in ٠–٩. */
const dateLocale = (locale: Locale) => (locale === 'ar' ? 'ar' : 'en-GB');

export function formatTime(locale: Locale, iso: string): string {
  return formatDateTime(dateLocale(locale), iso, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + (locale === 'ar' ? ' (ت.ع.م)' : ' UTC');
}

export function formatDay(locale: Locale, day: string): string {
  return formatDate(dateLocale(locale), `${day}T00:00:00Z`, { dateStyle: 'medium', timeZone: 'UTC' });
}

/** An uptime ("99.95", already rounded by the model) as a percentage: "99.95%" / «٩٩٫٩٥٪». */
export function formatPercent(locale: Locale, value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return locale === 'ar' ? sharedPercent(locale, n / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : `${value}%`;
}
