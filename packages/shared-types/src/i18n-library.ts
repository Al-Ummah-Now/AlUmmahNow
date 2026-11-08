/**
 * Translation shapes for the Library (Story 29.6) and notification center
 * (Story 29.10), with their en/ar values (shared by the web static fallback and
 * the api-videos translation seed).
 */

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
  moveUp: string;
  moveDown: string;
  remove: string;
  savePost: string;
  unsavePost: string;
  postSaved: string;
  likedOn: string;
  createChannelForPlaylists: string;
}

export interface NotificationCenterTranslations {
  title: string;
  bellLabel: string;
  bellLabelUnread: string;
  latest: string;
  markAllRead: string;
  markRead: string;
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
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
}

export const LIBRARY_EN: LibraryTranslations = {
  title: 'Library',
  description: 'Your history, saved videos, likes, playlists and saved posts',
  signInPrompt: 'Sign in to see your library',
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
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  savePost: 'Save post',
  unsavePost: 'Remove from saved posts',
  postSaved: 'Saved',
  likedOn: 'Liked {date}',
  createChannelForPlaylists: 'Create a channel to make playlists',
};

export const LIBRARY_AR: LibraryTranslations = {
  title: 'المكتبة',
  description: 'سجل المشاهدة والفيديوهات المحفوظة والإعجابات وقوائم التشغيل والمنشورات المحفوظة',
  signInPrompt: 'سجّل الدخول لعرض مكتبتك',
  signIn: 'تسجيل الدخول',
  history: 'سجل المشاهدة',
  watchLater: 'المشاهدة لاحقًا',
  likedVideos: 'الفيديوهات التي أعجبتك',
  playlists: 'قوائم التشغيل',
  savedPosts: 'المنشورات المحفوظة',
  seeAll: 'عرض الكل',
  emptyHistory: 'ستظهر هنا الفيديوهات التي تشاهدها',
  continueWatching: 'متابعة المشاهدة',
  watchedPercent: 'تمت مشاهدة {percent}%',
  emptyWatchLater: 'احفظ الفيديوهات لمشاهدتها لاحقًا وستظهر هنا',
  emptyLiked: 'ستظهر هنا الفيديوهات التي تعجبك',
  emptyPlaylists: 'ستظهر هنا قوائم التشغيل التي تنشئها',
  emptySavedPosts: 'ستظهر هنا منشورات المجتمع التي تحفظها',
  videosCount: '{count} فيديو',
  loadMore: 'تحميل المزيد',
  loadError: 'تعذّر تحميل هذا القسم',
  retry: 'إعادة المحاولة',
  saveToWatchLater: 'حفظ للمشاهدة لاحقًا',
  removeFromWatchLater: 'إزالة من المشاهدة لاحقًا',
  savedToWatchLater: 'تم الحفظ للمشاهدة لاحقًا',
  removedFromWatchLater: 'تمت الإزالة من المشاهدة لاحقًا',
  watchLaterFull: 'قائمة المشاهدة لاحقًا ممتلئة. أزل بعض الفيديوهات أولًا.',
  actionFailed: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
  moreActions: 'مزيد من الإجراءات لـ {title}',
  moveUp: 'نقل لأعلى',
  moveDown: 'نقل لأسفل',
  remove: 'إزالة',
  savePost: 'حفظ المنشور',
  unsavePost: 'إزالة من المنشورات المحفوظة',
  postSaved: 'محفوظ',
  likedOn: 'أعجبك في {date}',
  createChannelForPlaylists: 'أنشئ قناة لإنشاء قوائم التشغيل',
};

export const NOTIFICATION_CENTER_EN: NotificationCenterTranslations = {
  title: 'Notifications',
  bellLabel: 'Notifications',
  bellLabelUnread: 'Notifications, {count} unread',
  latest: 'Latest notifications',
  markAllRead: 'Mark all as read',
  markRead: 'Mark as read',
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
  justNow: 'Just now',
  minutesAgo: '{count} min ago',
  hoursAgo: '{count} h ago',
  daysAgo: '{count} d ago',
};

export const NOTIFICATION_CENTER_AR: NotificationCenterTranslations = {
  title: 'الإشعارات',
  bellLabel: 'الإشعارات',
  bellLabelUnread: 'الإشعارات، {count} غير مقروءة',
  latest: 'أحدث الإشعارات',
  markAllRead: 'تحديد الكل كمقروء',
  markRead: 'تحديد كمقروء',
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
    new_videos: 'فيديوهات جديدة',
    live: 'البث المباشر',
    replies: 'الردود',
    comments: 'التعليقات على فيديوهاتي',
    subscribers: 'مشتركون جدد',
    uploads: 'معالجة الرفع',
  },
  categoryDescriptions: {
    new_videos: 'الفيديوهات الجديدة من القنوات التي تشترك فيها (حسب جرس كل قناة)',
    live: 'عندما تبدأ قناة تشترك فيها بثًا مباشرًا',
    replies: 'الردود على تعليقاتك',
    comments: 'التعليقات على الفيديوهات التي رفعتها',
    subscribers: 'عندما يشترك أحد في قناتك',
    uploads: 'اكتملت معالجة الفيديو الخاص بك أو فشلت',
  },
  channelBell: {
    label: 'إعدادات إشعارات هذه القناة',
    all: 'الكل',
    allDescription: 'كل فيديو جديد وكل بث مباشر',
    highlights: 'الأبرز',
    highlightsDescription: 'الفيديوهات الطويلة والبث المباشر دون اللمحات',
    none: 'بدون',
    noneDescription: 'لا إشعارات من هذه القناة',
    saved: 'تم تحديث إشعارات القناة',
    error: 'تعذّر تحديث إشعارات القناة',
  },
  justNow: 'الآن',
  minutesAgo: 'منذ {count} دقيقة',
  hoursAgo: 'منذ {count} ساعة',
  daysAgo: 'منذ {count} يوم',
};
