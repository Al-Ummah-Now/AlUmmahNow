/**
 * Translation shapes for the Library (Story 29.6) and notification center
 * (Story 29.10), with their en/ar values (shared by the web static fallback and
 * the api-videos translation seed).
 */

import type { ReportReason } from './moderation';

export interface LibraryTranslations {
  title: string;
  description: string;
  signInPrompt: string;
  signIn: string;
  history: string;
  watchLater: string;
  likedVideos: string;
  playlists: string;
  savedPosts: string;
  seeAll: string;
  emptyHistory: string;
  /** Home shelf of started, unfinished videos (#242) */
  continueWatching: string;
  /** Accessible label of a tile's watched-progress bar */
  watchedPercent: string;
  emptyWatchLater: string;
  emptyLiked: string;
  emptyPlaylists: string;
  emptySavedPosts: string;
  videosCount: string;
  loadMore: string;
  loadError: string;
  retry: string;
  saveToWatchLater: string;
  removeFromWatchLater: string;
  savedToWatchLater: string;
  removedFromWatchLater: string;
  watchLaterFull: string;
  actionFailed: string;
  moreActions: string;
  /** Share buttons (card menu, playlist, channel): copy the short link (wiki AUN-SHORT-LINKS) */
  copyLink: string;
  linkCopied: string;
  share: string;
  copyFailed: string;
  moveUp: string;
  moveDown: string;
  remove: string;
  savePost: string;
  unsavePost: string;
  postSaved: string;
  likedOn: string;
  /** Manage link of the personal playlists (no channel) */
  managePlaylists: string;
}

/** CLDR plural forms (Intl.PluralRules): English uses one/other, Arabic all six. */
export interface PluralTexts {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export interface NotificationToastTranslations {
  /** Label of the toast region (a landmark screen readers can jump to) */
  region: string;
  dismiss: string;
  view: string;
  viewAll: string;
  /** "+3 more" collapse; links to the notifications page */
  more: PluralTexts;
  /** One toast for several notifications of the same kind that arrived together */
  grouped: {
    uploadReady: PluralTexts;
    uploadFailed: PluralTexts;
    newComment: PluralTexts;
    newSubscriber: PluralTexts;
    newVideo: PluralTexts;
    liveStarted: PluralTexts;
    commentReply: PluralTexts;
    other: PluralTexts;
  };
}

export interface NotificationCenterTranslations {
  title: string;
  bellLabel: string;
  bellLabelUnread: string;
  /** Bell name when the badge shows notifications new since the menu was last opened. */
  bellLabelNew: string;
  latest: string;
  markAllRead: string;
  markRead: string;
  markUnread: string;
  delete: string;
  seeAll: string;
  settings: string;
  empty: string;
  emptyUnread: string;
  all: string;
  unread: string;
  loadMore: string;
  loadError: string;
  unreadDot: string;
  signInPrompt: string;
  settingsTitle: string;
  settingsDescription: string;
  settingsSaved: string;
  settingsError: string;
  categories: {
    new_videos: string;
    live: string;
    replies: string;
    comments: string;
    subscribers: string;
    uploads: string;
  };
  categoryDescriptions: {
    new_videos: string;
    live: string;
    replies: string;
    comments: string;
    subscribers: string;
    uploads: string;
  };
  channelBell: {
    label: string;
    all: string;
    allDescription: string;
    highlights: string;
    highlightsDescription: string;
    none: string;
    noneDescription: string;
    saved: string;
    error: string;
  };
  /**
   * Account warning from the moderators (notification key accountWarning).
   * `{reason}` is filled from `reasons`, `{count}` is the account's warning count.
   */
  accountWarning: {
    title: string;
    message: string;
    reasons: Record<ReportReason, string>;
  };
  /** Settings: email about the account (warnings and other account notices). */
  emailSettings: {
    title: string;
    description: string;
    account: string;
    accountDescription: string;
    language: string;
    languageDescription: string;
    languages: { en: string; ar: string };
    alwaysInApp: string;
  };
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
  /** Real-time toasts (bottom corner). Grouped texts are CLDR plural tables; `{count}` is the localized number. */
  toasts: NotificationToastTranslations;
}

export const LIBRARY_EN: LibraryTranslations = {
  title: 'You',
  description: 'Your history, saved videos, likes, playlists and saved posts',
  signInPrompt: 'Sign in to see your history, playlists and saved videos',
  signIn: 'Sign in',
  history: 'History',
  watchLater: 'Watch later',
  likedVideos: 'Liked videos',
  playlists: 'Playlists',
  savedPosts: 'Saved posts',
  seeAll: 'See all',
  emptyHistory: 'Videos you watch will appear here',
  continueWatching: 'Continue watching',
  watchedPercent: '{percent}% watched',
  emptyWatchLater: 'Save videos to watch later and they will appear here',
  emptyLiked: 'Videos you like will appear here',
  emptyPlaylists: 'Playlists you create will appear here',
  emptySavedPosts: 'Community posts you save will appear here',
  videosCount: '{count} videos',
  loadMore: 'Load more',
  loadError: 'Could not load this section',
  retry: 'Try again',
  saveToWatchLater: 'Save to Watch later',
  removeFromWatchLater: 'Remove from Watch later',
  savedToWatchLater: 'Saved to Watch later',
  removedFromWatchLater: 'Removed from Watch later',
  watchLaterFull: 'Watch later is full. Remove some videos first.',
  actionFailed: 'Something went wrong. Please try again.',
  moreActions: 'More actions for {title}',
  copyLink: 'Copy link',
  linkCopied: 'Link copied',
  share: 'Share',
  copyFailed: 'Could not copy the link',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  savePost: 'Save post',
  unsavePost: 'Remove from saved posts',
  postSaved: 'Saved',
  likedOn: 'Liked {date}',
  managePlaylists: 'Manage playlists',
};

export const LIBRARY_AR: LibraryTranslations = {
  title: 'أنت',
  description: 'سجل المشاهدة والمرئيات المحفوظة والإعجابات وقوائم التشغيل والمنشورات المحفوظة',
  signInPrompt: 'سجّل الدخول لعرض سجلّك وقوائم التشغيل والمرئيات المحفوظة',
  signIn: 'تسجيل الدخول',
  history: 'سجل المشاهدة',
  watchLater: 'المشاهدة لاحقًا',
  likedVideos: 'المرئيات التي أعجبتك',
  playlists: 'قوائم التشغيل',
  savedPosts: 'المنشورات المحفوظة',
  seeAll: 'عرض الكل',
  emptyHistory: 'ستظهر هنا المرئيات التي تشاهدها',
  continueWatching: 'متابعة المشاهدة',
  watchedPercent: 'تمت مشاهدة {percent}%',
  emptyWatchLater: 'احفظ المرئيات لمشاهدتها لاحقًا وستظهر هنا',
  emptyLiked: 'ستظهر هنا المرئيات التي تعجبك',
  emptyPlaylists: 'ستظهر هنا قوائم التشغيل التي تنشئها',
  emptySavedPosts: 'ستظهر هنا منشورات المجتمع التي تحفظها',
  videosCount: '{count} من المرئيات',
  loadMore: 'تحميل المزيد',
  loadError: 'تعذّر تحميل هذا القسم',
  retry: 'إعادة المحاولة',
  saveToWatchLater: 'حفظ للمشاهدة لاحقًا',
  removeFromWatchLater: 'إزالة من المشاهدة لاحقًا',
  savedToWatchLater: 'تم الحفظ للمشاهدة لاحقًا',
  removedFromWatchLater: 'تمت الإزالة من المشاهدة لاحقًا',
  watchLaterFull: 'قائمة المشاهدة لاحقًا ممتلئة. أزل بعض المرئيات أولًا.',
  actionFailed: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
  moreActions: 'مزيد من الإجراءات لـ {title}',
  copyLink: 'نسخ الرابط',
  linkCopied: 'تم نسخ الرابط',
  share: 'مشاركة',
  copyFailed: 'تعذّر نسخ الرابط',
  moveUp: 'نقل لأعلى',
  moveDown: 'نقل لأسفل',
  remove: 'إزالة',
  savePost: 'حفظ المنشور',
  unsavePost: 'إزالة من المنشورات المحفوظة',
  postSaved: 'محفوظ',
  likedOn: 'أعجبك في {date}',
  managePlaylists: 'إدارة قوائم التشغيل',
};

export const NOTIFICATION_CENTER_EN: NotificationCenterTranslations = {
  title: 'Notifications',
  bellLabel: 'Notifications',
  bellLabelUnread: 'Notifications, {count} unread',
  bellLabelNew: 'Notifications, {count} new',
  latest: 'Latest notifications',
  markAllRead: 'Mark all as read',
  markRead: 'Mark as read',
  markUnread: 'Mark as unread',
  delete: 'Delete notification',
  seeAll: 'See all notifications',
  settings: 'Notification settings',
  empty: "You're all caught up",
  emptyUnread: 'No unread notifications',
  all: 'All',
  unread: 'Unread',
  loadMore: 'Load more',
  loadError: 'Could not load notifications',
  unreadDot: 'Unread',
  signInPrompt: 'Sign in to see your notifications',
  settingsTitle: 'Notifications',
  settingsDescription: 'Choose what you want to be notified about',
  settingsSaved: 'Notification settings saved',
  settingsError: 'Could not save notification settings',
  categories: {
    new_videos: 'New videos',
    live: 'Live streams',
    replies: 'Replies',
    comments: 'Comments on my videos',
    subscribers: 'New subscribers',
    uploads: 'Upload processing',
  },
  categoryDescriptions: {
    new_videos: 'New uploads from channels you subscribe to (per-channel bell applies)',
    live: 'When a channel you subscribe to goes live',
    replies: 'Replies to your comments',
    comments: 'Comments on videos you uploaded',
    subscribers: 'Someone subscribes to your channel',
    uploads: 'Your video finished processing or failed',
  },
  channelBell: {
    label: 'Notification settings for this channel',
    all: 'All',
    allDescription: 'Every upload and live stream',
    highlights: 'Highlights',
    highlightsDescription: 'Long videos and live streams, no Lamahat',
    none: 'None',
    noneDescription: 'No notifications from this channel',
    saved: 'Channel notifications updated',
    error: 'Could not update channel notifications',
  },
  accountWarning: {
    title: 'Your account received a warning',
    message: 'Reason: {reason}. Warnings on your account: {count}. Please read the community guidelines to keep your account in good standing.',
    reasons: {
      inappropriate: 'inappropriate content',
      spam: 'spam or misleading content',
      harassment: 'harassment or bullying',
      copyright: 'copyright infringement',
      misinformation: 'false or misleading information',
      other: 'breaking the community guidelines',
    },
  },
  emailSettings: {
    title: 'Email',
    description: 'Emails about your account',
    account: 'Email me about my account',
    accountDescription: 'Warnings and other notices about your account. They always arrive here in your notifications too.',
    language: 'Email language',
    languageDescription: 'The language of emails we send you',
    languages: { en: 'English', ar: 'العربية' },
    alwaysInApp: 'Account notices always appear in your notifications.',
  },
  justNow: 'Just now',
  minutesAgo: '{count} min ago',
  hoursAgo: '{count} h ago',
  daysAgo: '{count} d ago',
  toasts: {
    region: 'Notifications',
    dismiss: 'Dismiss notification',
    view: 'View',
    viewAll: 'View all',
    more: { other: '+{count} more' },
    grouped: {
      uploadReady: { one: '{count} video finished processing', other: '{count} videos finished processing' },
      uploadFailed: { one: '{count} video could not be processed', other: '{count} videos could not be processed' },
      newComment: { one: '{count} new comment on your videos', other: '{count} new comments on your videos' },
      newSubscriber: { one: '{count} new subscriber', other: '{count} new subscribers' },
      newVideo: { one: '{count} new video from your subscriptions', other: '{count} new videos from your subscriptions' },
      liveStarted: { one: '{count} channel went live', other: '{count} channels went live' },
      commentReply: { one: '{count} new reply to your comments', other: '{count} new replies to your comments' },
      other: { one: '{count} new notification', other: '{count} new notifications' },
    },
  },
};

export const NOTIFICATION_CENTER_AR: NotificationCenterTranslations = {
  title: 'الإشعارات',
  bellLabel: 'الإشعارات',
  bellLabelUnread: 'الإشعارات، {count} غير مقروءة',
  bellLabelNew: 'الإشعارات، {count} جديدة',
  latest: 'أحدث الإشعارات',
  markAllRead: 'تحديد الكل كمقروء',
  markRead: 'تحديد كمقروء',
  markUnread: 'تحديد كغير مقروء',
  delete: 'حذف الإشعار',
  seeAll: 'عرض كل الإشعارات',
  settings: 'إعدادات الإشعارات',
  empty: 'لا توجد إشعارات جديدة',
  emptyUnread: 'لا توجد إشعارات غير مقروءة',
  all: 'الكل',
  unread: 'غير المقروءة',
  loadMore: 'تحميل المزيد',
  loadError: 'تعذّر تحميل الإشعارات',
  unreadDot: 'غير مقروء',
  signInPrompt: 'سجّل الدخول لعرض إشعاراتك',
  settingsTitle: 'الإشعارات',
  settingsDescription: 'اختر ما تريد أن تُشعَر به',
  settingsSaved: 'تم حفظ إعدادات الإشعارات',
  settingsError: 'تعذّر حفظ إعدادات الإشعارات',
  categories: {
    new_videos: 'مرئيات جديدة',
    live: 'البث المباشر',
    replies: 'الردود',
    comments: 'التعليقات على مرئياتي',
    subscribers: 'مشتركون جدد',
    uploads: 'معالجة الرفع',
  },
  categoryDescriptions: {
    new_videos: 'المرئيات الجديدة من القنوات التي تشترك فيها (حسب جرس كل قناة)',
    live: 'عندما تبدأ قناة تشترك فيها بثًا مباشرًا',
    replies: 'الردود على تعليقاتك',
    comments: 'التعليقات على المرئيات التي رفعتها',
    subscribers: 'عندما يشترك أحد في قناتك',
    uploads: 'اكتملت معالجة مرئيك أو فشلت',
  },
  channelBell: {
    label: 'إعدادات إشعارات هذه القناة',
    all: 'الكل',
    allDescription: 'كل مرئي جديد وكل بث مباشر',
    highlights: 'الأبرز',
    highlightsDescription: 'المرئيات الطويلة والبث المباشر دون اللمحات',
    none: 'بدون',
    noneDescription: 'لا إشعارات من هذه القناة',
    saved: 'تم تحديث إشعارات القناة',
    error: 'تعذّر تحديث إشعارات القناة',
  },
  accountWarning: {
    title: 'تلقّى حسابك تحذيرًا',
    message: 'السبب: {reason}. عدد التحذيرات على حسابك: {count}. يُرجى قراءة إرشادات المجتمع للحفاظ على حسابك في وضع جيد.',
    reasons: {
      inappropriate: 'محتوى غير لائق',
      spam: 'محتوى مزعج أو مضلِّل',
      harassment: 'التحرش أو التنمر',
      copyright: 'انتهاك حقوق النشر',
      misinformation: 'معلومات خاطئة أو مضلِّلة',
      other: 'مخالفة إرشادات المجتمع',
    },
  },
  emailSettings: {
    title: 'البريد الإلكتروني',
    description: 'رسائل البريد الإلكتروني المتعلقة بحسابك',
    account: 'راسلني بالبريد بشأن حسابي',
    accountDescription: 'التحذيرات والإشعارات الأخرى المتعلقة بحسابك. تصلك دائمًا هنا في إشعاراتك أيضًا.',
    language: 'لغة البريد الإلكتروني',
    languageDescription: 'لغة الرسائل التي نرسلها إليك',
    languages: { en: 'English', ar: 'العربية' },
    alwaysInApp: 'تظهر إشعارات الحساب دائمًا في إشعاراتك.',
  },
  justNow: 'الآن',
  minutesAgo: 'منذ {count} دقيقة',
  hoursAgo: 'منذ {count} ساعة',
  daysAgo: 'منذ {count} يوم',
  toasts: {
    region: 'الإشعارات',
    dismiss: 'إغلاق الإشعار',
    view: 'عرض',
    viewAll: 'عرض الكل',
    more: { one: '+ إشعار آخر', two: '+ إشعاران آخران', few: '+{count} إشعارات أخرى', many: '+{count} إشعارًا آخر', other: '+{count} إشعار آخر' },
    grouped: {
      uploadReady: {
        one: 'اكتملت معالجة مرئي واحد',
        two: 'اكتملت معالجة مرئيين',
        few: 'اكتملت معالجة {count} مرئيات',
        many: 'اكتملت معالجة {count} مرئيًا',
        other: 'اكتملت معالجة {count} مرئي',
      },
      uploadFailed: {
        one: 'تعذرت معالجة مرئي واحد',
        two: 'تعذرت معالجة مرئيين',
        few: 'تعذرت معالجة {count} مرئيات',
        many: 'تعذرت معالجة {count} مرئيًا',
        other: 'تعذرت معالجة {count} مرئي',
      },
      newComment: {
        one: 'تعليق جديد على مرئياتك',
        two: 'تعليقان جديدان على مرئياتك',
        few: '{count} تعليقات جديدة على مرئياتك',
        many: '{count} تعليقًا جديدًا على مرئياتك',
        other: '{count} تعليق جديد على مرئياتك',
      },
      newSubscriber: {
        one: 'مشترك جديد',
        two: 'مشتركان جديدان',
        few: '{count} مشتركين جدد',
        many: '{count} مشتركًا جديدًا',
        other: '{count} مشترك جديد',
      },
      newVideo: {
        one: 'مرئي جديد من اشتراكاتك',
        two: 'مرئيان جديدان من اشتراكاتك',
        few: '{count} مرئيات جديدة من اشتراكاتك',
        many: '{count} مرئيًا جديدًا من اشتراكاتك',
        other: '{count} مرئي جديد من اشتراكاتك',
      },
      liveStarted: {
        one: 'بدأت قناة بثًا مباشرًا',
        two: 'بدأت قناتان بثًا مباشرًا',
        few: 'بدأت {count} قنوات بثًا مباشرًا',
        many: 'بدأت {count} قناة بثًا مباشرًا',
        other: 'بدأت {count} قناة بثًا مباشرًا',
      },
      commentReply: {
        one: 'رد جديد على تعليقاتك',
        two: 'ردان جديدان على تعليقاتك',
        few: '{count} ردود جديدة على تعليقاتك',
        many: '{count} ردًا جديدًا على تعليقاتك',
        other: '{count} رد جديد على تعليقاتك',
      },
      other: {
        one: 'إشعار جديد',
        two: 'إشعاران جديدان',
        few: '{count} إشعارات جديدة',
        many: '{count} إشعارًا جديدًا',
        other: '{count} إشعار جديد',
      },
    },
  },
};
