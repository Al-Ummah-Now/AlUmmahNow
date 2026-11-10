/**
 * Static definition of the QA seed data set.
 *
 * Everything the seed creates is identified by a stable natural key (email,
 * channel name, video title, playlist title, post content) so re-runs can find
 * and skip items that already exist.
 */

export type SeedRole = 'superadmin' | 'admin' | 'moderator' | 'creator' | 'viewer' | 'ssoUi' | 'ssoUiChain' | 'ssoUiMultiA' | 'ssoUiMultiB' | 'ssoCms';

export interface SeedAccount {
  key: SeedRole;
  email: string;
  displayName: string;
  displayNameAr: string;
  bio: string;
  /** D1 rbac role id to assign, if any */
  rbacRoleId?: 'role_super_admin' | 'role_admin' | 'role_moderator';
}

/**
 * Mailbox domain of the seed accounts. QA's historical accounts live at
 * delivered.resend.dev (codes read through the Resend API); stage uses the auth
 * server's E2E code sink domain, e2e.alummahnow.net (SEED_EMAIL_DOMAIN).
 */
export const SEED_EMAIL_DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'delivered.resend.dev';

export const SEED_ACCOUNTS: readonly SeedAccount[] = [
  {
    // Super-admin-only admin flows (channel ownership transfer) in the admin-web E2E suite
    key: 'superadmin',
    email: `qa-superadmin@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA Super Admin',
    displayNameAr: 'المسؤول الأعلى للاختبار',
    bio: 'Seeded QA super administrator account.',
    rbacRoleId: 'role_super_admin',
  },
  {
    key: 'admin',
    email: `qa-admin@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA Admin',
    displayNameAr: 'مسؤول الاختبار',
    bio: 'Seeded QA administrator account.',
    rbacRoleId: 'role_admin',
  },
  {
    key: 'moderator',
    email: `qa-moderator@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA Moderator',
    displayNameAr: 'مشرف الاختبار',
    bio: 'Seeded QA moderator account.',
    rbacRoleId: 'role_moderator',
  },
  {
    key: 'creator',
    email: `qa-creator@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA Creator',
    displayNameAr: 'منشئ محتوى الاختبار',
    bio: 'Seeded QA content creator account.',
  },
  {
    key: 'viewer',
    email: `qa-viewer@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA Viewer',
    displayNameAr: 'مشاهد الاختبار',
    bio: 'Seeded QA viewer account.',
  },
  // Dedicated to ONE spec each, used by nothing else: the SSO journeys of
  // AlUmmahNowUI and AlUmmahNowCMS end with "sign out -> signed out of every
  // app", which ends every session of the account everywhere. On a shared
  // account that bounced other suites to the sign-in page mid-test (CMS QA E2E,
  // 2026-11-10). Those repos have no per-run account secrets yet; once they do,
  // their journeys move to per-run accounts and these go.
  {
    key: 'ssoUi',
    email: `qa-sso-ui@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA SSO Journey (UI)',
    displayNameAr: 'رحلة الدخول الموحد للاختبار (الواجهة)',
    bio: 'Seeded QA account used only by the AlUmmahNowUI SSO journey spec.',
  },
  // AlUmmahNowUI accounts-chain and accounts-signed-in specs (sign out, account
  // switching): one account each, never shared. The display name carries the
  // address's local part: the specs find it in the account menu.
  {
    key: 'ssoUiChain',
    email: `qa-sso-ui-chain@${SEED_EMAIL_DOMAIN}`,
    displayName: 'qa-sso-ui-chain',
    displayNameAr: 'qa-sso-ui-chain',
    bio: 'Seeded QA account used only by the AlUmmahNowUI accounts-chain spec.',
  },
  {
    key: 'ssoUiMultiA',
    email: `qa-sso-ui-multi-a@${SEED_EMAIL_DOMAIN}`,
    displayName: 'qa-sso-ui-multi-a',
    displayNameAr: 'qa-sso-ui-multi-a',
    bio: 'Seeded QA account used only by the AlUmmahNowUI accounts-signed-in spec (first account).',
  },
  {
    key: 'ssoUiMultiB',
    email: `qa-sso-ui-multi-b@${SEED_EMAIL_DOMAIN}`,
    displayName: 'qa-sso-ui-multi-b',
    displayNameAr: 'qa-sso-ui-multi-b',
    bio: 'Seeded QA account used only by the AlUmmahNowUI accounts-signed-in spec (second account).',
  },
  {
    key: 'ssoCms',
    email: `qa-sso-cms@${SEED_EMAIL_DOMAIN}`,
    displayName: 'QA SSO Journey (CMS)',
    displayNameAr: 'رحلة الدخول الموحد للاختبار (إدارة المحتوى)',
    bio: 'Seeded QA account used only by the AlUmmahNowCMS SSO journey spec (CMS editor access needs the admin role).',
    rbacRoleId: 'role_admin',
  },
];

export type VideoCategory =
  | 'quran_recitation'
  | 'quran_tafsir'
  | 'hadith_studies'
  | 'islamic_history'
  | 'fiqh'
  | 'aqeedah'
  | 'dawah'
  | 'khutbah'
  | 'islamic_lectures'
  | 'islamic_nasheed'
  | 'islamic_kids'
  | 'islamic_news'
  | 'hajj_umrah'
  | 'ramadan'
  | 'islamic_lifestyle';

export interface SeedVideo {
  /** Stable slug used for the generated media file name */
  slug: string;
  title: string;
  titleAr: string;
  description: string;
  descriptionAr: string;
  category: VideoCategory;
  tags: string[];
  language: 'en' | 'ar';
  /** Seconds. Channel "Videos" tab hides anything shorter than 60s (shorts). */
  durationSeconds: number;
  /** Generated test pattern orientation */
  orientation: 'landscape' | 'portrait';
  /** Tone frequency (Hz) so every file has distinct audio */
  toneHz: number;
  /** Upload as private and schedule publication ~1 day in the future */
  scheduled?: boolean;
  /** Attach the sample WebVTT subtitles and chapters to this video */
  withSubtitlesAndChapters?: boolean;
}

export interface SeedChannel {
  key: 'lectures' | 'nasheeds';
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  isMain: boolean;
  playlistTitle: string;
  playlistDescription: string;
  videos: SeedVideo[];
}

export const SEED_CHANNELS: readonly SeedChannel[] = [
  {
    key: 'lectures',
    name: 'Al Ummah Now QA — Lectures',
    nameAr: 'الأمة الآن (اختبار) — محاضرات',
    description: 'QA seed channel with short sample lectures. Content is generated test media.',
    descriptionAr: 'قناة اختبار تحتوي على محاضرات قصيرة نموذجية. المحتوى عبارة عن وسائط اختبار مولدة.',
    isMain: true,
    playlistTitle: 'QA Lectures — Starter Playlist',
    playlistDescription: 'All seeded QA lectures in one playlist.',
    videos: [
      {
        slug: 'lecture-tafsir-intro',
        title: 'QA Lecture 1 — Introduction to Tafsir',
        titleAr: 'محاضرة اختبار ١ — مقدمة في التفسير',
        description: 'Seeded QA video: an introduction to tafsir. Generated test pattern with tone.',
        descriptionAr: 'فيديو اختبار: مقدمة في التفسير. نمط اختبار مولد مع نغمة.',
        category: 'quran_tafsir',
        tags: ['qa-seed', 'tafsir', 'lecture'],
        language: 'en',
        durationSeconds: 75,
        orientation: 'landscape',
        toneHz: 440,
        withSubtitlesAndChapters: true,
      },
      {
        slug: 'lecture-hadith-basics',
        title: 'QA Lecture 2 — Hadith Basics',
        titleAr: 'محاضرة اختبار ٢ — أساسيات الحديث',
        description: 'Seeded QA video about hadith studies.',
        descriptionAr: 'فيديو اختبار عن علوم الحديث.',
        category: 'hadith_studies',
        tags: ['qa-seed', 'hadith', 'lecture'],
        language: 'en',
        durationSeconds: 70,
        orientation: 'landscape',
        toneHz: 523,
      },
      {
        slug: 'lecture-seerah',
        title: 'QA Lecture 3 — Seerah Overview',
        titleAr: 'محاضرة اختبار ٣ — نظرة عامة على السيرة',
        description: 'Seeded QA video on Islamic history (seerah).',
        descriptionAr: 'فيديو اختبار عن التاريخ الإسلامي (السيرة).',
        category: 'islamic_history',
        tags: ['qa-seed', 'seerah', 'history'],
        language: 'ar',
        durationSeconds: 65,
        orientation: 'landscape',
        toneHz: 587,
      },
      {
        slug: 'lecture-scheduled-fiqh',
        title: 'QA Lecture 4 — Fiqh of Prayer (Scheduled)',
        titleAr: 'محاضرة اختبار ٤ — فقه الصلاة (مجدولة)',
        description: 'Seeded QA video scheduled for publication about one day after seeding.',
        descriptionAr: 'فيديو اختبار مجدول للنشر بعد يوم تقريباً من إنشائه.',
        category: 'fiqh',
        tags: ['qa-seed', 'fiqh', 'scheduled'],
        language: 'en',
        durationSeconds: 65,
        orientation: 'landscape',
        toneHz: 659,
        scheduled: true,
      },
    ],
  },
  {
    key: 'nasheeds',
    name: 'QA Nasheeds',
    nameAr: 'أناشيد الاختبار',
    description: 'QA seed channel with sample nasheeds. Content is generated test media.',
    descriptionAr: 'قناة اختبار تحتوي على أناشيد نموذجية. المحتوى عبارة عن وسائط اختبار مولدة.',
    isMain: false,
    playlistTitle: 'QA Nasheeds — Favourites',
    playlistDescription: 'All seeded QA nasheeds in one playlist.',
    videos: [
      {
        slug: 'nasheed-tala-al-badru',
        title: 'QA Nasheed 1 — Tala al Badru (Sample)',
        titleAr: 'نشيد اختبار ١ — طلع البدر (نموذج)',
        description: 'Seeded QA nasheed sample. Generated test tone.',
        descriptionAr: 'نموذج نشيد اختبار. نغمة اختبار مولدة.',
        category: 'islamic_nasheed',
        tags: ['qa-seed', 'nasheed'],
        language: 'ar',
        durationSeconds: 70,
        orientation: 'landscape',
        toneHz: 349,
      },
      {
        slug: 'nasheed-kids',
        title: 'QA Nasheed 2 — Kids Nasheed (Sample)',
        titleAr: 'نشيد اختبار ٢ — نشيد للأطفال (نموذج)',
        description: 'Seeded QA nasheed for kids.',
        descriptionAr: 'نشيد اختبار للأطفال.',
        category: 'islamic_kids',
        tags: ['qa-seed', 'nasheed', 'kids'],
        language: 'ar',
        durationSeconds: 65,
        orientation: 'landscape',
        toneHz: 392,
      },
      {
        slug: 'nasheed-ramadan',
        title: 'QA Nasheed 3 — Ramadan Nasheed (Sample)',
        titleAr: 'نشيد اختبار ٣ — نشيد رمضان (نموذج)',
        description: 'Seeded QA Ramadan nasheed.',
        descriptionAr: 'نشيد رمضان للاختبار.',
        category: 'ramadan',
        tags: ['qa-seed', 'nasheed', 'ramadan'],
        language: 'ar',
        durationSeconds: 65,
        orientation: 'landscape',
        toneHz: 415,
      },
      {
        slug: 'nasheed-short',
        title: 'QA Nasheed Short — Vertical Clip',
        titleAr: 'مقطع نشيد قصير للاختبار',
        description: 'Seeded QA short (under 60 seconds, vertical) so the Shorts tab has content.',
        descriptionAr: 'مقطع قصير للاختبار (أقل من ٦٠ ثانية، عمودي).',
        category: 'islamic_nasheed',
        tags: ['qa-seed', 'nasheed', 'short'],
        language: 'ar',
        durationSeconds: 20,
        orientation: 'portrait',
        toneHz: 466,
      },
    ],
  },
];

/** Channel owned by the viewer; the API requires a channelId header for likes, comments and subscriptions. */
export const VIEWER_CHANNEL = {
  name: 'QA Viewer Channel',
  nameAr: 'قناة مشاهد الاختبار',
  description: 'Personal channel of the seeded QA viewer (required to like, comment and subscribe).',
  descriptionAr: 'القناة الشخصية لمشاهد الاختبار (مطلوبة للإعجاب والتعليق والاشتراك).',
};

export const COMMUNITY_TEXT_POST =
  'Assalamu alaikum! Welcome to the Al Ummah Now QA Lectures channel. New sample lectures are uploaded by the QA seed. [qa-seed]';

export const COMMUNITY_POLL = {
  question: 'Which QA lecture topic should we seed next? [qa-seed]',
  options: ['Tafsir', 'Hadith', 'Seerah', 'Fiqh'],
};

export const VIEWER_COMMENTS = [
  { videoSlug: 'lecture-tafsir-intro', text: 'JazakAllahu khairan for this QA lecture! [qa-seed]' },
  { videoSlug: 'nasheed-tala-al-badru', text: 'Beautiful sample nasheed, ma sha Allah. [qa-seed]' },
];

export const VIEWER_LIKED_VIDEO_SLUG = 'lecture-tafsir-intro';
export const VIEWER_WATCHED_VIDEO_SLUG = 'lecture-hadith-basics';

/** Sample WebVTT for the video flagged withSubtitlesAndChapters */
export const SAMPLE_WEBVTT_EN = `WEBVTT

00:00:00.000 --> 00:00:05.000
Bismillah. Welcome to this QA sample lecture.

00:00:05.000 --> 00:00:15.000
This video was generated by the QA seed workflow.

00:00:15.000 --> 00:00:30.000
Chapter one: what is tafsir?

00:00:30.000 --> 00:00:45.000
Chapter two: the sources of tafsir.

00:00:45.000 --> 00:01:00.000
Chapter three: closing remarks.
`;

export const SAMPLE_WEBVTT_AR = `WEBVTT

00:00:00.000 --> 00:00:05.000
بسم الله. مرحباً بكم في هذه المحاضرة التجريبية.

00:00:05.000 --> 00:00:15.000
تم إنشاء هذا الفيديو بواسطة سير عمل بيانات الاختبار.

00:00:15.000 --> 00:00:30.000
الفصل الأول: ما هو التفسير؟

00:00:30.000 --> 00:00:45.000
الفصل الثاني: مصادر التفسير.

00:00:45.000 --> 00:01:00.000
الفصل الثالث: الخاتمة.
`;

/** Chapters (ids are fixed UUIDs so re-runs write identical data) */
export const SAMPLE_CHAPTERS = [
  {
    id: '6f1c9a52-6d0b-4c1e-9a51-0a1b2c3d4e01',
    startTime: 0,
    endTime: 15,
    title: 'Introduction',
    titleLocalized: { en: 'Introduction', ar: 'المقدمة' },
  },
  {
    id: '6f1c9a52-6d0b-4c1e-9a51-0a1b2c3d4e02',
    startTime: 15,
    endTime: 30,
    title: 'What is tafsir?',
    titleLocalized: { en: 'What is tafsir?', ar: 'ما هو التفسير؟' },
  },
  {
    id: '6f1c9a52-6d0b-4c1e-9a51-0a1b2c3d4e03',
    startTime: 30,
    endTime: 45,
    title: 'Sources of tafsir',
    titleLocalized: { en: 'Sources of tafsir', ar: 'مصادر التفسير' },
  },
  {
    id: '6f1c9a52-6d0b-4c1e-9a51-0a1b2c3d4e04',
    startTime: 45,
    endTime: 74,
    title: 'Closing remarks',
    titleLocalized: { en: 'Closing remarks', ar: 'الخاتمة' },
  },
];
