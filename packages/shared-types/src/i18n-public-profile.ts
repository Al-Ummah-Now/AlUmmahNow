/**
 * Public profile (Story 29.5): the page at /{locale}/u/@{handle} and its settings, en and ar.
 * Used directly by locale (like i18n-contact.ts); the handle wording follows the channel handle
 * strings in i18n-static.
 */

export interface PublicProfileTranslations {
  page: {
    /** "@{handle}" line under the name */
    joined: string;
    channels: string;
    subscriptions: string;
    playlists: string;
    likes: string;
    emptySubscriptions: string;
    emptyPlaylists: string;
    emptyLikes: string;
    showMore: string;
    loadError: string;
    /** Shown to the owner on their own profile */
    ownerNote: string;
    editSettings: string;
    /** SEO description when the user has no bio */
    fallbackDescription: string;
    avatarAlt: string;
    coverAlt: string;
  };
  settings: {
    /** Settings index card */
    cardTitle: string;
    cardDescription: string;
    title: string;
    intro: string;
    handleLabel: string;
    handleHelp: string;
    handlePlaceholder: string;
    handleChecking: string;
    handleAvailable: string;
    handleCurrent: string;
    handleTaken: string;
    handleReserved: string;
    handleTooShort: string;
    handleTooLong: string;
    handleInvalid: string;
    noHandle: string;
    removeHandle: string;
    showTitle: string;
    showHelp: string;
    alwaysShown: string;
    showSubscriptions: string;
    showSubscriptionsHelp: string;
    showPlaylists: string;
    showPlaylistsHelp: string;
    showLikes: string;
    showLikesHelp: string;
    save: string;
    saving: string;
    saved: string;
    saveFailed: string;
    viewProfile: string;
    loadFailed: string;
    signInTitle: string;
    signInMessage: string;
  };
}

export const PUBLIC_PROFILE_EN: PublicProfileTranslations = {
  page: {
    joined: 'Joined {date}',
    channels: 'Channels',
    subscriptions: 'Subscriptions',
    playlists: 'Playlists',
    likes: 'Liked videos',
    emptySubscriptions: 'No public subscriptions yet.',
    emptyPlaylists: 'No public playlists yet.',
    emptyLikes: 'No liked videos yet.',
    showMore: 'Show more',
    loadError: "This list couldn't load. Try again.",
    ownerNote: 'This is how others see your profile.',
    editSettings: 'Edit what your profile shows',
    fallbackDescription: '{name} on Al Ummah Now.',
    avatarAlt: '{name} profile picture',
    coverAlt: '{name} banner',
  },
  settings: {
    cardTitle: 'Public profile',
    cardDescription: 'Your @handle and what others see on your profile',
    title: 'Public profile',
    intro: 'Pick a @handle to get a public profile page. It shows your name, picture, bio and public channels, plus the lists you turn on below. Remove the handle to take the page down.',
    handleLabel: 'Handle',
    handleHelp: 'Your profile URL: {url}. 3 to 30 characters: Latin letters, digits, periods, underscores and hyphens.',
    handlePlaceholder: 'yourhandle',
    handleChecking: 'Checking availability…',
    handleAvailable: '@{handle} is available',
    handleCurrent: 'This is your current handle',
    handleTaken: 'This handle is already taken',
    handleReserved: 'This handle is reserved',
    handleTooShort: 'Handles need at least 3 characters',
    handleTooLong: 'Handles can have at most 30 characters',
    handleInvalid: 'Use Latin letters, digits, periods, underscores and hyphens, starting and ending with a letter or digit',
    noHandle: "You don't have a public profile yet.",
    removeHandle: 'Remove handle',
    showTitle: 'What your profile shows',
    showHelp: 'Only public things are ever listed: private and unlisted channels, playlists and videos stay hidden.',
    alwaysShown: 'Always shown: your name, picture, bio and public channels.',
    showSubscriptions: 'Subscriptions',
    showSubscriptionsHelp: 'The public channels you subscribe to',
    showPlaylists: 'Playlists',
    showPlaylistsHelp: 'Your public playlists',
    showLikes: 'Liked videos',
    showLikesHelp: 'The public videos you liked',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: "Your changes couldn't be saved. Try again.",
    viewProfile: 'View your profile',
    loadFailed: "Your profile settings couldn't load. Try again.",
    signInTitle: 'Sign in to set up your public profile',
    signInMessage: 'Your public profile and what it shows are part of your account.',
  },
};

export const PUBLIC_PROFILE_AR: PublicProfileTranslations = {
  page: {
    joined: 'انضم في {date}',
    channels: 'القنوات',
    subscriptions: 'الاشتراكات',
    playlists: 'قوائم التشغيل',
    likes: 'المرئيات المعجب بها',
    emptySubscriptions: 'لا توجد اشتراكات عامة بعد.',
    emptyPlaylists: 'لا توجد قوائم تشغيل عامة بعد.',
    emptyLikes: 'لا توجد مرئيات معجب بها بعد.',
    showMore: 'عرض المزيد',
    loadError: 'تعذّر تحميل هذه القائمة. حاول مرة أخرى.',
    ownerNote: 'هكذا يرى الآخرون ملفك الشخصي.',
    editSettings: 'تعديل ما يعرضه ملفك الشخصي',
    fallbackDescription: '{name} على الأمة الآن.',
    avatarAlt: 'صورة الملف الشخصي لـ{name}',
    coverAlt: 'صورة غلاف {name}',
  },
  settings: {
    cardTitle: 'الملف الشخصي العام',
    cardDescription: 'معرّفك @ وما يراه الآخرون في ملفك الشخصي',
    title: 'الملف الشخصي العام',
    intro: 'اختر معرّفًا @ لتحصل على صفحة ملف شخصي عامة. تعرض اسمك وصورتك ونبذتك وقنواتك العامة، والقوائم التي تفعّلها أدناه. احذف المعرّف لإزالة الصفحة.',
    handleLabel: 'المعرّف',
    handleHelp: 'رابط ملفك الشخصي: {url}. من 3 إلى 30 حرفًا: أحرف لاتينية وأرقام ونقاط وشرطات سفلية وشرطات.',
    handlePlaceholder: 'yourhandle',
    handleChecking: 'جارٍ التحقق من التوفر…',
    handleAvailable: '@{handle} متاح',
    handleCurrent: 'هذا هو معرّفك الحالي',
    handleTaken: 'هذا المعرّف مستخدم بالفعل',
    handleReserved: 'هذا المعرّف محجوز',
    handleTooShort: 'يجب أن يتكون المعرّف من 3 أحرف على الأقل',
    handleTooLong: 'يمكن أن يتكون المعرّف من 30 حرفًا على الأكثر',
    handleInvalid: 'استخدم أحرفًا لاتينية وأرقامًا ونقاطًا وشرطات سفلية وشرطات، على أن يبدأ وينتهي بحرف أو رقم',
    noHandle: 'ليس لديك ملف شخصي عام بعد.',
    removeHandle: 'حذف المعرّف',
    showTitle: 'ما يعرضه ملفك الشخصي',
    showHelp: 'لا يُعرض إلا ما هو عام: القنوات وقوائم التشغيل والمرئيات الخاصة وغير المدرجة تبقى مخفية.',
    alwaysShown: 'يُعرض دائمًا: اسمك وصورتك ونبذتك وقنواتك العامة.',
    showSubscriptions: 'الاشتراكات',
    showSubscriptionsHelp: 'القنوات العامة التي تشترك فيها',
    showPlaylists: 'قوائم التشغيل',
    showPlaylistsHelp: 'قوائم التشغيل العامة الخاصة بك',
    showLikes: 'المرئيات المعجب بها',
    showLikesHelp: 'المرئيات العامة التي أعجبتك',
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ',
    saveFailed: 'تعذّر حفظ التغييرات. حاول مرة أخرى.',
    viewProfile: 'عرض ملفك الشخصي',
    loadFailed: 'تعذّر تحميل إعدادات ملفك الشخصي. حاول مرة أخرى.',
    signInTitle: 'سجّل الدخول لإعداد ملفك الشخصي العام',
    signInMessage: 'ملفك الشخصي العام وما يعرضه جزء من حسابك.',
  },
};

export function publicProfileTranslations(locale: string): PublicProfileTranslations {
  return locale === 'ar' ? PUBLIC_PROFILE_AR : PUBLIC_PROFILE_EN;
}
