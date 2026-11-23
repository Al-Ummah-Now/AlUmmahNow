/**
 * Every feature an admin can switch on or off (wiki AUN-FEATURES §2, decision O39; owner request
 * 2026-11-22: "enable and disable features, from videos admin on one page for all features with
 * help text, enforced on web and native apps").
 *
 * One list, read by the videos admin's Features page, admin-api (writes, permissions, audit),
 * api-videos and the processor (enforcement, jobs) and the web. Native apps get what they need in
 * API answers (`GET /api/me/features`, the error envelope) and never copy this list.
 *
 * A switch is an admin master switch. It sits in front of everything else that decides a feature
 * (configuration, tier, channel role): a feature is on for someone only while its switch is on
 * AND the rest says yes. Defaults equal what the platform did before the switches existed, so the
 * first deploy changes nothing (viewerCaptionDownload was already off).
 *
 * Keys are stable: add, never rename (clients and stored rows use them).
 */
import type { UserFeatureKey } from './features';

export const FEATURE_GROUPS = ['create', 'captions', 'grow', 'people', 'site', 'islamic'] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export interface FeatureText {
  en: string;
  ar: string;
}

/**
 * Where a switch lived before the Features page. While a key has no `feature_switches` row, the
 * server reads this place with that feature's existing reader (api-videos `lib/features/switches`),
 * so the first deploy keeps every value an admin already set. The first write creates the row.
 */
export type LegacySwitchSource =
  | 'captions.translation.enabled'
  | 'captions.inline.enabled'
  | 'captions.viewerTitles.enabled'
  | 'captions.viewerDownload.enabled'
  | 'youtubeImport.enabled'
  | 'social.platform.enabled'
  | 'categorize.visibility.enabled'
  | 'creatorTierSettings.tier_requests_enabled';

/** Background work that respects a switch (§5.4): parked while off, resumed when on. */
export type FeatureJob = 'caption_transcribe' | 'caption_translate' | 'youtube_import' | 'social_post' | 'newsletter_issue' | 'categorize';

export interface FeatureDefinition {
  key: FeatureKey;
  group: FeatureGroup;
  name: FeatureText;
  /** What people lose while it is off, in whole sentences */
  help: FeatureText;
  /** The `feature_off` message (wiki §5.2); without one: "{name} isn’t available right now." */
  offMessage?: FeatureText;
  /** The value before anyone changes it */
  default: boolean;
  /** Who may change it: admins and super admins, or super admins only */
  toggle: 'admin' | 'superAdmin';
  /** When the Features page asks first */
  confirm: 'never' | 'off' | 'on' | 'both';
  /** On only while every one of these is on (wiki §2.2) */
  requires: readonly FeatureKey[];
  /** `GET /api/me/features` keys this switch turns off */
  userFeatureKeys: readonly UserFeatureKey[];
  /** `GET /public/features` (www) keys this switch turns off */
  publicFeatureKeys?: readonly 'newsletter'[];
  /** The admin page where the feature is set up (keys, budgets, networks), if any */
  setupHref?: string;
  legacy?: LegacySwitchSource;
  jobs?: readonly FeatureJob[];
  /** What a client does while it can't read the answer (wiki §6.2) */
  offline: 'lastKnownElseHidden';
}

export const FEATURE_KEYS = [
  'upload',
  'createChannel',
  'youtubeImport',
  'bulkSchedule',
  'audioTracks',
  'live',
  'liveChat',
  'livePremieres',
  'liveReminders',
  'liveEvents',
  'captionsTranscribe',
  'captionsTranslate',
  'inlineTranslate',
  'viewerTranslatedTitles',
  'quranEditions',
  'viewerCaptionDownload',
  'socialAutopost',
  'aiCategorySuggest',
  'siteDomains',
  'creatorSupport',
  'supportExternalLinks',
  'charityDonations',
  'supportPerks',
  'prayerTimes',
  'qibla',
  'hijriCalendar',
  'ramadanMode',
  'recitationTools',
  'intentionalViewing',
  'studyNotes',
  'tierRequests',
  'eventCalendar',
  'newsletter',
  'listenMode',
  'offlineDownloads',
  'appUpdates',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** `/api/me/features` keys that follow something other than a switch, and why (registry test). */
export const AUTOMATIC_FEATURE_KEYS: Readonly<Partial<Record<UserFeatureKey, string>>> = Object.freeze({
  quranText: 'On while our Quran Foundation copy is synced and less than 7 days old (QF1).',
  billing: 'On while a payment provider is on, or the account has subscriptions or payments (O37).',
});

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = Object.freeze([
  // --- Creating ------------------------------------------------------------
  {
    key: 'upload',
    group: 'create',
    name: { en: 'Uploads', ar: 'الرفع' },
    help: {
      en: 'Nobody can upload new videos: uploads pause in Studio on the web and in the apps, and imports pause in Tools. Videos already uploaded keep processing and stay published.',
      ar: 'لا يستطيع أحد رفع مرئيات جديدة: يتوقف الرفع في الاستوديو على الويب والتطبيقات، وتتوقف عمليات الاستيراد في الأدوات. تكمل المرئيات المرفوعة معالجتها وتبقى منشورة.',
    },
    offMessage: { en: 'Uploading isn’t available right now.', ar: 'الرفع غير متاح الآن.' },
    default: true,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['upload'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'createChannel',
    group: 'create',
    name: { en: 'Creating channels', ar: 'إنشاء القنوات' },
    help: {
      en: 'Nobody can create a new channel. Existing channels and their teams keep working.',
      ar: 'لا يستطيع أحد إنشاء قناة جديدة. تبقى القنوات الحالية وفرقها تعمل.',
    },
    offMessage: { en: 'Creating a channel isn’t available right now.', ar: 'إنشاء قناة غير متاح الآن.' },
    default: true,
    toggle: 'superAdmin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: ['createChannel'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'youtubeImport',
    group: 'create',
    name: { en: 'Move from YouTube', ar: 'النقل من يوتيوب' },
    help: {
      en: 'Creators can’t start moving a channel from YouTube. Moves already running pause and continue when it’s back on.',
      ar: 'لا يستطيع صنّاع المحتوى بدء نقل قناة من يوتيوب. تتوقف عمليات النقل الجارية مؤقتًا وتكمل عند إعادة التشغيل.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'off',
    requires: ['upload'],
    userFeatureKeys: ['youtubeImport'],
    setupHref: '/platform-settings',
    legacy: 'youtubeImport.enabled',
    jobs: ['youtube_import'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'bulkSchedule',
    group: 'create',
    name: { en: 'Bulk scheduling', ar: 'الجدولة الجماعية' },
    help: {
      en: 'Studio loses “Schedule selected”. Videos already scheduled still publish on time.',
      ar: 'يختفي «جدولة المحدد» من الاستوديو. تُنشر المرئيات المجدولة مسبقًا في موعدها.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['bulkSchedule'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'audioTracks',
    group: 'create',
    name: { en: 'Extra audio tracks', ar: 'المسارات الصوتية الإضافية' },
    help: {
      en: 'Creators can’t add audio tracks. Tracks already added keep playing and can still be removed.',
      ar: 'لا يستطيع صنّاع المحتوى إضافة مسارات صوتية. تبقى المسارات المضافة تعمل ويمكن حذفها.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: ['upload'],
    userFeatureKeys: ['audioTracks'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'live',
    group: 'create',
    name: { en: 'Live streaming', ar: 'البث المباشر' },
    help: {
      en: 'Nobody can start a new live stream. Streams already on air continue to their end.',
      ar: 'لا يستطيع أحد بدء بث مباشر جديد. يستمر البث الجاري حتى نهايته.',
    },
    offMessage: { en: 'Live streaming isn’t available right now.', ar: 'البث المباشر غير متاح الآن.' },
    default: true,
    toggle: 'superAdmin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: ['live'],
    setupHref: '/live-streaming',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'liveChat',
    group: 'people',
    name: { en: 'Live chat', ar: 'محادثة البث المباشر' },
    help: {
      en: 'Viewers can’t send or read live chat messages on live streams and premieres, and recordings don’t show chat replay.',
      ar: 'لا يستطيع المشاهدون إرسال رسائل المحادثة المباشرة أو قراءتها في البث المباشر والعروض الأولى، ولا تعرض التسجيلات إعادة المحادثة.',
    },
    offMessage: { en: 'Live chat isn’t available right now.', ar: 'محادثة البث المباشر غير متاحة الآن.' },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['liveChat'],
    setupHref: '/live-streaming',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'livePremieres',
    group: 'create',
    name: { en: 'Video premieres', ar: 'العروض الأولى للمرئيات' },
    help: {
      en: 'Creators can’t schedule an uploaded video as a live premiere with a countdown.',
      ar: 'لا يستطيع صنّاع المحتوى جدولة مرئي مرفوع كعرض أول مباشر مع عدّ تنازلي.',
    },
    offMessage: { en: 'Video premieres aren’t available right now.', ar: 'العروض الأولى للمرئيات غير متاحة الآن.' },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['livePremieres'],
    setupHref: '/live-streaming',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'liveReminders',
    group: 'people',
    name: { en: 'Live reminders', ar: 'تذكيرات البث المباشر' },
    help: {
      en: 'Viewers can’t set reminders or download calendar alerts for upcoming live streams and premieres.',
      ar: 'لا يستطيع المشاهدون ضبط تذكيرات أو تنزيل تنبيهات التقويم للبث المباشر والعروض الأولى القادمة.',
    },
    offMessage: { en: 'Live reminders aren’t available right now.', ar: 'تذكيرات البث المباشر غير متاحة الآن.' },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['liveReminders'],
    setupHref: '/live-streaming',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'liveEvents',
    group: 'create',
    name: { en: 'Live events', ar: 'فعاليات البث المباشر' },
    help: {
      en: 'Creators can’t tag streams as community events such as Jumu’ah, Taraweeh, conferences or lectures, and the events filter disappears.',
      ar: 'لا يستطيع صنّاع المحتوى وسم البث كفعالية مجتمعية مثل الجمعة أو التراويح أو المؤتمرات أو حلقات العلم، ويختفي مرشّح الفعاليات.',
    },
    offMessage: { en: 'Live events aren’t available right now.', ar: 'فعاليات البث المباشر غير متاحة الآن.' },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['liveEvents'],
    setupHref: '/live-streaming',
    offline: 'lastKnownElseHidden',
  },
  // --- Captions and translation --------------------------------------------
  {
    key: 'captionsTranscribe',
    group: 'captions',
    name: { en: 'Transcription', ar: 'التفريغ النصي' },
    help: {
      en: 'Creators can’t make captions from a video’s speech. Queued transcriptions wait and run when it’s back on. Captions already made stay.',
      ar: 'لا يستطيع صنّاع المحتوى إنشاء ترجمة نصية من كلام المرئي. تنتظر عمليات التفريغ في الطابور وتعمل عند إعادة التشغيل. تبقى الترجمات الموجودة.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: ['captionsTranscribe'],
    setupHref: '/captions-settings',
    jobs: ['caption_transcribe'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'captionsTranslate',
    group: 'captions',
    name: { en: 'Caption translation', ar: 'ترجمة الترجمات النصية' },
    help: {
      en: 'Creators can’t translate captions into other languages. Queued translations wait. Translations already made stay.',
      ar: 'لا يستطيع صنّاع المحتوى ترجمة الترجمات النصية إلى لغات أخرى. تنتظر الترجمات في الطابور. تبقى الترجمات الموجودة.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['captionsTranslate'],
    setupHref: '/captions-settings',
    legacy: 'captions.translation.enabled',
    jobs: ['caption_translate'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'inlineTranslate',
    group: 'captions',
    name: { en: 'Translate button', ar: 'زر الترجمة' },
    help: {
      en: 'The Translate button beside titles and descriptions disappears from Studio.',
      ar: 'يختفي زر الترجمة بجانب العناوين والأوصاف من الاستوديو.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['inlineTranslate'],
    setupHref: '/captions-settings',
    legacy: 'captions.inline.enabled',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'viewerTranslatedTitles',
    group: 'captions',
    name: { en: 'Translated titles for viewers', ar: 'العناوين المترجمة للمشاهدين' },
    help: {
      en: 'Viewers see titles only in the language they were written in.',
      ar: 'يرى المشاهدون العناوين بلغتها الأصلية فقط.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['viewerTranslatedTitles'],
    setupHref: '/captions-settings',
    legacy: 'captions.viewerTitles.enabled',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'quranEditions',
    group: 'captions',
    name: { en: 'Quran translation editions', ar: 'ترجمات معاني القرآن' },
    help: {
      en: 'Quran passages in captions show without a translation edition.',
      ar: 'تظهر الآيات في الترجمة النصية دون ترجمة لمعانيها.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['quranEditions'],
    setupHref: '/captions-settings',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'viewerCaptionDownload',
    group: 'captions',
    name: { en: 'Caption download for viewers', ar: 'تنزيل الترجمة للمشاهدين' },
    help: {
      en: 'Viewers can’t download a video’s caption file from the player. Channel owners and editors still download their own captions in Studio.',
      ar: 'لا يستطيع المشاهدون تنزيل ملف الترجمة النصية من المشغّل. يبقى أصحاب القنوات ومحرروها قادرين على تنزيل ترجماتهم من الاستوديو.',
    },
    default: false,
    toggle: 'superAdmin',
    confirm: 'on',
    requires: [],
    userFeatureKeys: ['viewerCaptionDownload'],
    legacy: 'captions.viewerDownload.enabled',
    offline: 'lastKnownElseHidden',
  },
  // --- Growth and sharing --------------------------------------------------
  {
    key: 'socialAutopost',
    group: 'grow',
    name: { en: 'Social auto-post', ar: 'النشر التلقائي على مواقع التواصل' },
    help: {
      en: 'New videos aren’t posted to channels’ social accounts. Posts waiting to go out pause and are sent when it’s back on.',
      ar: 'لا تُنشر المرئيات الجديدة على حسابات القنوات في مواقع التواصل. تتوقف المنشورات المنتظرة مؤقتًا وتُرسل عند إعادة التشغيل.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: ['socialAutopost'],
    setupHref: '/social',
    legacy: 'social.platform.enabled',
    jobs: ['social_post'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'aiCategorySuggest',
    group: 'grow',
    name: { en: 'AI category suggestions', ar: 'اقتراحات التصنيف الآلية' },
    help: {
      en: 'The upload and edit forms stop suggesting categories. Creators still pick categories themselves.',
      ar: 'تتوقف نماذج الرفع والتعديل عن اقتراح التصنيفات. يختار صنّاع المحتوى التصنيفات بأنفسهم.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['aiCategorySuggest'],
    setupHref: '/category-suggestions',
    legacy: 'categorize.visibility.enabled',
    jobs: ['categorize'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'siteDomains',
    group: 'grow',
    name: { en: 'Own domains', ar: 'النطاقات الخاصة' },
    help: {
      en: 'Scholar sites can’t add their own domain. Domains already added keep working and can still be removed.',
      ar: 'لا تستطيع مواقع العلماء إضافة نطاق خاص. تبقى النطاقات المضافة تعمل ويمكن حذفها.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['siteDomains'],
    setupHref: '/sites',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'creatorSupport',
    group: 'grow',
    name: { en: 'Creator support', ar: 'دعم صنّاع المحتوى' },
    help: {
      en: 'Viewers can’t send creators one-time or monthly support, and creators can’t receive it. The platform takes nothing from support. Turning it on needs the organization formed and a finance approver.',
      ar: 'لا يستطيع المشاهدون إرسال دعم لمرة واحدة أو شهري لصنّاع المحتوى، ولا يستقبل صنّاع المحتوى أي دعم. لا تأخذ المنصة شيئًا من الدعم. يتطلب التشغيل تأسيس المنظمة وتعيين معتمِد مالي.',
    },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['support', 'supportReceive'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'supportExternalLinks',
    group: 'grow',
    name: { en: 'External support links', ar: 'روابط الدعم الخارجية' },
    help: {
      en: 'Creators can’t add links to their support pages on other sites.',
      ar: 'لا يستطيع صنّاع المحتوى إضافة روابط لصفحات دعمهم على مواقع أخرى.',
    },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: ['creatorSupport'],
    userFeatureKeys: [],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'charityDonations',
    group: 'grow',
    name: { en: 'Charity donations', ar: 'التبرعات الخيرية' },
    help: {
      en: 'Viewers can’t donate to the charities a creator chooses.',
      ar: 'لا يستطيع المشاهدون التبرع للجهات الخيرية التي يختارها صانع المحتوى.',
    },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: ['creatorSupport'],
    userFeatureKeys: [],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'supportPerks',
    group: 'grow',
    name: { en: 'Supporter perks', ar: 'مزايا الداعمين' },
    help: {
      en: 'Creators can’t offer perks to the people who support them.',
      ar: 'لا يستطيع صنّاع المحتوى تقديم مزايا لمن يدعمونهم.',
    },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: ['creatorSupport'],
    userFeatureKeys: ['supportPerks'],
    offline: 'lastKnownElseHidden',
  },
  // --- Islamic experience (E21; all off until the owner enables them) --------
  {
    key: 'prayerTimes',
    group: 'islamic',
    name: { en: 'Prayer times', ar: 'أوقات الصلاة' },
    help: {
      en: 'Prayer times, reminders, and auto-pause disappear from every app.',
      ar: 'تختفي أوقات الصلاة والتذكيرات والإيقاف المؤقت التلقائي من كل التطبيقات.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['prayerTimes'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'qibla',
    group: 'islamic',
    name: { en: 'Qibla direction', ar: 'اتجاه القبلة' },
    help: {
      en: 'The Qibla bearing and compass disappear from every app.',
      ar: 'تختفي زاوية القبلة والبوصلة من كل التطبيقات.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['qibla'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'hijriCalendar',
    group: 'islamic',
    name: { en: 'Hijri calendar', ar: 'التقويم الهجري' },
    help: {
      en: 'Optional Hijri dates disappear from every app.',
      ar: 'تختفي التواريخ الهجرية الاختيارية من كل التطبيقات.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['hijriCalendar'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'ramadanMode',
    group: 'islamic',
    name: { en: 'Ramadan and Islamic seasons', ar: 'رمضان والمواسم الإسلامية' },
    help: {
      en: 'Ramadan, Dhul-Hijjah, and Jumu’ah seasonal tools disappear.',
      ar: 'تختفي أدوات رمضان وذي الحجة والجمعة.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'never',
    requires: ['hijriCalendar', 'prayerTimes'],
    userFeatureKeys: ['ramadanMode'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'recitationTools',
    group: 'islamic',
    name: { en: 'Recitation tools', ar: 'أدوات التلاوة' },
    help: {
      en: 'Recitation references, reciter details, and surah and ayah links disappear. Existing captions are unchanged.',
      ar: 'تختفي مراجع التلاوة وبيانات القارئ وروابط السور والآيات. تبقى الترجمات النصية الحالية دون تغيير.',
    },
    default: false,
    toggle: 'superAdmin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['recitationTools', 'recitationMetadata'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'intentionalViewing',
    group: 'islamic',
    name: { en: 'Intentional viewing', ar: 'المشاهدة الهادفة' },
    help: {
      en: 'Finite sessions, daily-time reminders, and finite Lamahat disappear.',
      ar: 'تختفي الجلسات المحدودة وتذكيرات الوقت اليومي واللمحات المحدودة.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['intentionalViewing'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'studyNotes',
    group: 'islamic',
    name: { en: 'Private notes', ar: 'الملاحظات الخاصة' },
    help: {
      en: 'Time-stamped notes on videos, their list, and Markdown export disappear. Existing notes are kept and stay private.',
      ar: 'تختفي الملاحظات المرتبطة بوقت في المرئي وقائمتها وتصديرها. تبقى الملاحظات الحالية محفوظة وخاصة.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'never',
    requires: [],
    userFeatureKeys: ['studyNotes'],
    offline: 'lastKnownElseHidden',
  },
  // --- People --------------------------------------------------------------
  {
    key: 'tierRequests',
    group: 'people',
    name: { en: 'Tier requests', ar: 'طلبات الفئات' },
    help: {
      en: 'While no payment provider is on, the Upgrade page and every link to it disappear, and nobody can ask for a tier. Requests already sent stay in the admin queue.',
      ar: 'ما دام لا يوجد مزوّد دفع مفعّل، تختفي صفحة الترقية وكل الروابط إليها، ولا يستطيع أحد طلب فئة. تبقى الطلبات المرسلة في قائمة الإدارة.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: [],
    setupHref: '/tier-requests',
    legacy: 'creatorTierSettings.tier_requests_enabled',
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'eventCalendar',
    group: 'people',
    name: { en: 'Event calendar', ar: 'تقويم الفعاليات' },
    help: {
      en: 'The upcoming events calendar and calendar feed downloads disappear. Scheduled live streams and premieres still run on time.',
      ar: 'يختفي تقويم الفعاليات القادمة وتنزيل خلاصات المواعيد. يستمر البث المباشر والعروض الأولى المجدولة في موعدها.',
    },
    offMessage: { en: 'The event calendar isn’t available right now.', ar: 'تقويم الفعاليات غير متاح الآن.' },
    default: false,
    toggle: 'admin',
    confirm: 'both',
    requires: [],
    userFeatureKeys: ['eventCalendar'],
    offline: 'lastKnownElseHidden',
  },
  // --- Public site ---------------------------------------------------------
  {
    key: 'newsletter',
    group: 'site',
    name: { en: 'Newsletter sign-up', ar: 'الاشتراك في النشرة البريدية' },
    help: {
      en: 'The sign-up form leaves the www footer and the newsletter page answers “not found”. People already subscribed can still unsubscribe. Issues waiting to go out pause.',
      ar: 'يختفي نموذج الاشتراك من تذييل الموقع، ولا تُعرض صفحة النشرة. يبقى بإمكان المشتركين إلغاء الاشتراك. تتوقف الأعداد المنتظرة مؤقتًا.',
    },
    default: true,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: [],
    publicFeatureKeys: ['newsletter'],
    setupHref: '/newsletter',
    jobs: ['newsletter_issue'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'listenMode',
    group: 'site',
    name: { en: 'Listen mode', ar: 'وضع الاستماع' },
    help: {
      en: 'The audio-first Listen button, mini audio bar, sleep timer and background audio controls disappear across web and native apps.',
      ar: 'يختفي زر الاستماع الصوتي وشريط الصوت المصغّر ومؤقّت النوم وعناصر التحكم بالصوت في الخلفية من الويب والتطبيقات.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: ['listenMode'],
    offline: 'lastKnownElseHidden',
  },
  {
    key: 'offlineDownloads',
    group: 'site',
    name: { en: 'Offline downloads', ar: 'التنزيل دون اتصال' },
    help: {
      en: 'Viewers can’t start new offline downloads or refresh download licenses, and the download toggle disappears from Studio. Removing existing downloads still works.',
      ar: 'لا يستطيع المشاهدون بدء تنزيلات جديدة دون اتصال أو تجديد تراخيص التنزيل، ويختفي خيار السماح بالتنزيل من الاستوديو. يبقى حذف التنزيلات الموجودة متاحًا.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: ['offlineDownloads'],
    offline: 'lastKnownElseHidden',
  },
  // --- Apps -----------------------------------------------------------------
  {
    key: 'appUpdates',
    group: 'site',
    name: { en: 'App update notices', ar: 'تنبيهات تحديث التطبيقات' },
    help: {
      en: 'The phone, TV and desktop apps stop telling people about new versions and stop installing updates themselves. The minimum version on the App config page stops applying, so builds below it keep working.',
      ar: 'تتوقف تطبيقات الهاتف والتلفاز وسطح المكتب عن إخبار الناس بالإصدارات الجديدة وعن تثبيت التحديثات بنفسها. ويتوقف تطبيق الحد الأدنى للإصدار في صفحة إعدادات التطبيقات، فتبقى الإصدارات الأقدم منه تعمل.',
    },
    default: false,
    toggle: 'admin',
    confirm: 'off',
    requires: [],
    userFeatureKeys: [],
    setupHref: '/app-config',
    offline: 'lastKnownElseHidden',
  },
] satisfies FeatureDefinition[]);

const BY_KEY: ReadonlyMap<string, FeatureDefinition> = new Map(FEATURE_REGISTRY.map((d) => [d.key, d]));

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && BY_KEY.has(value);
}

export function featureDefinition(key: FeatureKey): FeatureDefinition {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown feature key: ${key}`);
  return def;
}

export type FeatureSwitches = Record<FeatureKey, boolean>;

/** Every switch at its default: what the platform does before anyone changes anything. */
export const DEFAULT_FEATURE_SWITCHES: FeatureSwitches = Object.freeze(
  Object.fromEntries(FEATURE_REGISTRY.map((d) => [d.key, d.default])) as FeatureSwitches,
) as FeatureSwitches;

/** Stored values over the defaults; anything but a boolean for a known key is ignored. */
export function withDefaults(stored: Partial<Record<string, unknown>> | null | undefined): FeatureSwitches {
  const out = { ...DEFAULT_FEATURE_SWITCHES };
  for (const def of FEATURE_REGISTRY) {
    const value = stored?.[def.key];
    if (typeof value === 'boolean') out[def.key] = value;
  }
  return out;
}

/** Required features that are off (directly or through their own requirements), in registry order. */
export function blockedBy(key: FeatureKey, stored: FeatureSwitches): FeatureKey[] {
  const out: FeatureKey[] = [];
  const seen = new Set<FeatureKey>();
  const walk = (k: FeatureKey) => {
    for (const req of featureDefinition(k).requires) {
      if (seen.has(req)) continue;
      seen.add(req);
      if (!stored[req]) out.push(req);
      walk(req);
    }
  };
  walk(key);
  return FEATURE_KEYS.filter((k) => out.includes(k));
}

/** On only while its own switch and every requirement are on (wiki §2.2). */
export function effectiveSwitches(stored: FeatureSwitches): FeatureSwitches {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, stored[k] && blockedBy(k, stored).length === 0])) as FeatureSwitches;
}

/** Features that go dark with `key` (they require it, directly or not). */
export function dependantsOf(key: FeatureKey): FeatureKey[] {
  return FEATURE_KEYS.filter((k) => k !== key && blockedBy(k, { ...DEFAULT_FEATURE_SWITCHES, ...allOn(), [key]: false }).includes(key));
}

function allOn(): FeatureSwitches {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as FeatureSwitches;
}

/**
 * Turns `/api/me/features` keys off where their switch is off. Keys no switch covers pass through,
 * so configuration, tier and role still decide them.
 */
export function applySwitchesToUserFeatures<T extends Partial<Record<UserFeatureKey, boolean>>>(features: T, effective: FeatureSwitches): T {
  const out = { ...features };
  for (const def of FEATURE_REGISTRY) {
    if (effective[def.key]) continue;
    for (const k of def.userFeatureKeys) if (k in out) (out as Record<string, boolean>)[k] = false;
  }
  return out;
}

/** The switch that covers a `/api/me/features` key, if any. */
export function switchForUserFeature(key: UserFeatureKey): FeatureKey | null {
  return FEATURE_REGISTRY.find((d) => d.userFeatureKeys.includes(key))?.key ?? null;
}

/** "{name} isn’t available right now." in the given language, or the entry's own message. */
export function featureOffMessage(key: FeatureKey | null | undefined, lang: 'en' | 'ar'): string {
  if (!key || !isFeatureKey(key)) return lang === 'ar' ? 'هذه الميزة غير متاحة الآن.' : 'This feature isn’t available right now.';
  const def = featureDefinition(key);
  if (def.offMessage) return def.offMessage[lang];
  return lang === 'ar' ? `ميزة «${def.name.ar}» غير متاحة الآن.` : `${def.name.en} isn’t available right now.`;
}

/** Of `keys` (USER_FEATURE_KEYS), those neither switched nor automatic (registry test: none). */
export function uncoveredUserFeatureKeys(keys: readonly UserFeatureKey[]): UserFeatureKey[] {
  const covered = new Set<string>(FEATURE_REGISTRY.flatMap((d) => d.userFeatureKeys));
  return keys.filter((k) => !covered.has(k) && !(k in AUTOMATIC_FEATURE_KEYS));
}

/**
 * What a switch that is on still needs before it works (the Features page's "Needs setup" line;
 * api-videos and admin-api decide `ready`, wiki AUN-FEATURES §3).
 */
export const FEATURE_SETUP_NOTES: Readonly<Partial<Record<FeatureKey, FeatureText>>> = Object.freeze({
  youtubeImport: { en: 'Needs the Google client ID and secret.', ar: 'يحتاج إلى معرّف عميل جوجل وكلمته السرية.' },
  audioTracks: { en: 'Needs the media transcoder.', ar: 'يحتاج إلى خدمة تحويل الوسائط.' },
  live: { en: 'Needs a live provider that can take streams.', ar: 'يحتاج إلى مزوّد بث مباشر يستقبل البث.' },
  captionsTranscribe: { en: 'Needs a monthly caption budget.', ar: 'يحتاج إلى ميزانية شهرية للترجمة النصية.' },
  captionsTranslate: { en: 'Needs a monthly caption budget.', ar: 'يحتاج إلى ميزانية شهرية للترجمة النصية.' },
  inlineTranslate: { en: 'Needs a daily allowance and a monthly budget.', ar: 'يحتاج إلى حصة يومية وميزانية شهرية.' },
  viewerTranslatedTitles: { en: 'Needs a monthly translation budget.', ar: 'يحتاج إلى ميزانية شهرية للترجمة.' },
  quranEditions: { en: 'Needs the Quran Foundation credentials.', ar: 'يحتاج إلى بيانات اعتماد مؤسسة القرآن.' },
  recitationTools: { en: 'Needs a fresh Quran Foundation copy.', ar: 'يحتاج إلى نسخة حديثة من مؤسسة القرآن.' },
  socialAutopost: { en: 'Needs at least one network connected and on.', ar: 'يحتاج إلى شبكة واحدة على الأقل مربوطة ومفعّلة.' },
  aiCategorySuggest: { en: 'Needs the category suggestion queue.', ar: 'يحتاج إلى طابور اقتراح التصنيفات.' },
  siteDomains: { en: 'Needs own-domain hosting set up.', ar: 'يحتاج إلى إعداد استضافة النطاقات الخاصة.' },
  newsletter: { en: 'Needs an email sending key.', ar: 'يحتاج إلى مفتاح لإرسال البريد.' },
});

/** What api-videos reports per switch for the Features page (GET /internal/admin/features/state). */
export interface FeatureStateReport {
  /** The old setting's value for switches that have one (used while a switch has no row) */
  legacy: Partial<Record<FeatureKey, boolean>>;
  /** Set up enough to work when on; null: decided elsewhere (newsletter: admin-api) */
  ready: Partial<Record<FeatureKey, boolean | null>>;
}
