/**
 * Channel sections (docs/specs/CHANNEL-SECTIONS.md §11), en/ar: the add and
 * edit flow, the section manager and the channel Home tab. Shared by the web
 * static fallback and the api-videos translation seed.
 * Placeholders in braces ({count}, {max}) are filled by the page.
 */
import type { ChannelSectionType } from './channel-section';

type PerType = Record<ChannelSectionType, string>;

export interface ChannelSectionsTranslations {
  groups: { videos: string; playlists: string; channels: string; community: string };
  /** Card label in the dialog and default title on the channel */
  labels: PerType & { live_streams_past: string; shorts_popular: string };
  descriptions: PerType & { live_streams_past: string; shorts_popular: string };
  chooseType: string;
  privateData: string;
  alreadyAdded: string;
  back: string;
  hidden: string;
  pinnedFirst: string;
  /** Why a section is hidden from visitors (owner only) */
  emptyHints: {
    noContent: string;
    consentMissing: string;
    communityTabHidden: string;
    loadFailed: string;
  };
  /** Per-type "nothing yet" detail shown with emptyHints.noContent */
  emptyDetails: PerType;
  editSections: string;
  loadFailedForOwner: string;
  retry: string;
  errors: {
    section_limit: string;
    section_type_limit: string;
    owner_consent_required: string;
    consent_required: string;
    invalid_video: string;
    invalid_playlist: string;
    invalid_channel: string;
    validation_failed: string;
    forbidden: string;
    generic: string;
  };
  form: {
    titleOptional: string;
    titleRequiredHint: string;
    videos: string;
    pickVideos: string;
    searchVideos: string;
    pasteVideo: string;
    addPasted: string;
    pastedNotFound: string;
    selectedCount: string;
    maxReached: string;
    noVideos: string;
    playlists: string;
    pickPlaylist: string;
    pickPlaylists: string;
    noPlaylists: string;
    channels: string;
    searchChannels: string;
    searchChannelsHint: string;
    searchPlaylists: string;
    noChannelsFound: string;
    remove: string;
    moveUp: string;
    moveDown: string;
    spotlightTrailer: string;
    spotlightTrailerHint: string;
    spotlightReturning: string;
    spotlightReturningHint: string;
    spotlightNeedsOne: string;
    none: string;
    change: string;
    sort: string;
    sortLatest: string;
    sortPopular: string;
    liveFilter: string;
    liveAndUpcoming: string;
    pastLive: string;
    postMode: string;
    postLatest: string;
    postPinned: string;
    itemCount: string;
    postCount: string;
    consentLabel: string;
    consentSubscriptions: string;
    consentLikes: string;
    consentRequired: string;
    ownerOnlyConsent: string;
    pickRequired: string;
    loading: string;
  };
  render: {
    watch: string;
    trailer: string;
    forSubscribers: string;
    seeAllPosts: string;
    pinned: string;
    poll: string;
    pollOptions: string;
    likes: string;
    comments: string;
    live: string;
    upcoming: string;
    videosCount: string;
  };
}

export const CHANNEL_SECTIONS_EN: ChannelSectionsTranslations = {
  groups: { videos: 'Videos', playlists: 'Playlists', channels: 'Channels', community: 'Community' },
  labels: {
    channel_spotlight: 'Channel spotlight',
    featured_videos: 'Featured videos',
    recent_uploads: 'Latest videos',
    popular_uploads: 'Popular videos',
    shorts: 'Shorts',
    shorts_popular: 'Popular Shorts',
    live_streams: 'Live and upcoming',
    live_streams_past: 'Past live streams',
    liked_videos: 'Liked videos',
    single_playlist: 'Single playlist',
    multiple_playlists: 'Featured playlists',
    created_playlists: 'Created playlists',
    featured_channels: 'Featured channels',
    subscribed_channels: 'Subscriptions',
    community_posts: 'Community posts',
  },
  descriptions: {
    channel_spotlight: 'A trailer for new visitors and a featured video for subscribers',
    featured_videos: 'Videos you pick, in your order',
    recent_uploads: 'Your newest videos',
    popular_uploads: 'Your most-watched videos',
    shorts: 'Your newest Shorts',
    shorts_popular: 'Your most-watched Shorts',
    live_streams: 'What is live now, then what is scheduled',
    live_streams_past: 'Recordings of your past live streams',
    liked_videos: 'Videos you liked, shown publicly',
    single_playlist: 'One series or course as a row of its videos',
    multiple_playlists: 'Playlists you pick',
    created_playlists: 'All your public playlists, newest first',
    featured_channels: 'Channels you recommend, under your own title',
    subscribed_channels: 'Channels you subscribe to, shown publicly',
    community_posts: 'Your latest posts, or your pinned post',
  },
  chooseType: 'Choose what this section shows',
  privateData: 'Private data',
  alreadyAdded: 'Already on your channel',
  back: 'Back',
  hidden: 'Hidden',
  pinnedFirst: 'Always shown first',
  emptyHints: {
    noContent: "Visitors don't see this section until it has something to show.",
    consentMissing: 'Hidden: turn on public display to show it.',
    communityTabHidden: 'Hidden because your Community tab is hidden.',
    loadFailed: "This section couldn't be loaded right now. Visitors don't see it.",
  },
  emptyDetails: {
    channel_spotlight: 'The spotlight videos are not public any more.',
    featured_videos: 'None of the picked videos is public right now.',
    recent_uploads: 'Publish a video to fill it.',
    popular_uploads: 'Publish a video to fill it.',
    shorts: 'Publish a Short to fill it.',
    live_streams: 'Nothing is live or scheduled.',
    liked_videos: "You haven't liked any public videos yet.",
    single_playlist: 'The playlist is private, removed or has no public videos.',
    multiple_playlists: 'None of the picked playlists is public right now.',
    created_playlists: 'Create a public playlist to fill it.',
    featured_channels: 'None of the picked channels is available right now.',
    subscribed_channels: 'You have no public subscriptions to show.',
    community_posts: 'Publish a public post to fill it.',
  },
  editSections: 'Edit sections',
  loadFailedForOwner: "Couldn't load your sections.",
  retry: 'Try again',
  errors: {
    section_limit: 'You can have up to 12 sections.',
    section_type_limit: 'This section is already on your channel.',
    owner_consent_required: 'Only the channel owner can show their subscriptions or likes.',
    consent_required: 'Confirm that visitors may see this.',
    invalid_video: 'A picked video is not available. Choose a public video.',
    invalid_playlist: 'Choose a public playlist of this channel.',
    invalid_channel: "A picked channel is not available, or it's this channel.",
    validation_failed: 'Check the section settings and try again.',
    forbidden: "You can't change this channel's sections.",
    generic: "Couldn't save the section. Try again.",
  },
  form: {
    titleOptional: 'Leave empty to use the default title.',
    titleRequiredHint: 'Give this section a title, for example "Our scholars".',
    videos: 'Videos',
    pickVideos: 'Pick videos',
    searchVideos: 'Search your videos',
    pasteVideo: 'Or paste a video link or ID',
    addPasted: 'Add',
    pastedNotFound: 'No public video found for that link.',
    selectedCount: '{count} of {max} selected',
    maxReached: 'You picked the maximum.',
    noVideos: 'No public videos found.',
    playlists: 'Playlists',
    pickPlaylist: 'Pick a playlist',
    pickPlaylists: 'Pick playlists',
    noPlaylists: 'This channel has no public playlists yet.',
    channels: 'Channels',
    searchChannels: 'Search channels by name or @handle',
    searchChannelsHint: 'Most viewed channels first; type a name or @handle to search.',
    searchPlaylists: 'Search playlists',
    noChannelsFound: 'No channels found.',
    remove: 'Remove',
    moveUp: 'Move up',
    moveDown: 'Move down',
    spotlightTrailer: 'Trailer for new visitors',
    spotlightTrailerHint: 'Shown to people who have not subscribed.',
    spotlightReturning: 'Featured video for subscribers',
    spotlightReturningHint: 'Shown to subscribers when they come back.',
    spotlightNeedsOne: 'Pick at least one video.',
    none: 'None',
    change: 'Change',
    sort: 'Order',
    sortLatest: 'Newest first',
    sortPopular: 'Most watched first',
    liveFilter: 'Show',
    liveAndUpcoming: 'Live and upcoming',
    pastLive: 'Past live streams',
    postMode: 'Show',
    postLatest: 'Latest posts',
    postPinned: 'Pinned post only',
    itemCount: 'Items to show',
    postCount: 'Posts to show',
    consentLabel: 'Show this publicly',
    consentSubscriptions: 'Anyone who visits your channel will see the channels you subscribe to.',
    consentLikes: 'Anyone who visits your channel will see the videos you have liked.',
    consentRequired: 'Tick the box to show this on your channel.',
    ownerOnlyConsent: 'Only the channel owner can turn this on.',
    pickRequired: 'Pick at least one.',
    loading: 'Loading…',
  },
  render: {
    watch: 'Watch',
    trailer: 'Channel trailer',
    forSubscribers: 'For subscribers',
    seeAllPosts: 'See all posts',
    pinned: 'Pinned',
    poll: 'Poll',
    pollOptions: '{count} options',
    likes: '{count} likes',
    comments: '{count} comments',
    live: 'Live',
    upcoming: 'Upcoming',
    videosCount: '{count} videos',
  },
};

export const CHANNEL_SECTIONS_AR: ChannelSectionsTranslations = {
  groups: { videos: 'الفيديوهات', playlists: 'قوائم التشغيل', channels: 'القنوات', community: 'المجتمع' },
  labels: {
    channel_spotlight: 'واجهة القناة',
    featured_videos: 'فيديوهات مميزة',
    recent_uploads: 'أحدث الفيديوهات',
    popular_uploads: 'الأكثر مشاهدة',
    shorts: 'مقاطع قصيرة',
    shorts_popular: 'المقاطع القصيرة الأكثر مشاهدة',
    live_streams: 'مباشر وقادم',
    live_streams_past: 'البث السابق',
    liked_videos: 'الفيديوهات التي أعجبتني',
    single_playlist: 'قائمة تشغيل واحدة',
    multiple_playlists: 'قوائم تشغيل مميزة',
    created_playlists: 'قوائم التشغيل المنشأة',
    featured_channels: 'قنوات مميزة',
    subscribed_channels: 'الاشتراكات',
    community_posts: 'منشورات المجتمع',
  },
  descriptions: {
    channel_spotlight: 'مقدمة للزوار الجدد وفيديو مميز للمشتركين',
    featured_videos: 'فيديوهات تختارها بالترتيب الذي تريده',
    recent_uploads: 'أحدث فيديوهاتك',
    popular_uploads: 'فيديوهاتك الأكثر مشاهدة',
    shorts: 'أحدث مقاطعك القصيرة',
    shorts_popular: 'مقاطعك القصيرة الأكثر مشاهدة',
    live_streams: 'ما يُبث الآن، ثم ما هو مجدول',
    live_streams_past: 'تسجيلات البث المباشر السابق',
    liked_videos: 'الفيديوهات التي أعجبتك، معروضة للجميع',
    single_playlist: 'سلسلة أو دورة واحدة في صف من فيديوهاتها',
    multiple_playlists: 'قوائم تشغيل تختارها',
    created_playlists: 'كل قوائم التشغيل العامة، الأحدث أولًا',
    featured_channels: 'قنوات توصي بها، تحت عنوان تختاره',
    subscribed_channels: 'القنوات التي تشترك فيها، معروضة للجميع',
    community_posts: 'أحدث منشوراتك، أو منشورك المثبّت',
  },
  chooseType: 'اختر ما يعرضه هذا القسم',
  privateData: 'بيانات خاصة',
  alreadyAdded: 'موجود في قناتك',
  back: 'رجوع',
  hidden: 'مخفي',
  pinnedFirst: 'يظهر أولًا دائمًا',
  emptyHints: {
    noContent: 'لا يرى الزوار هذا القسم حتى يكون فيه ما يُعرض.',
    consentMissing: 'مخفي: فعّل العرض العام لإظهاره.',
    communityTabHidden: 'مخفي لأن تبويب المجتمع مخفي.',
    loadFailed: 'تعذّر تحميل هذا القسم الآن، ولا يراه الزوار.',
  },
  emptyDetails: {
    channel_spotlight: 'فيديوهات الواجهة لم تعد عامة.',
    featured_videos: 'لا يوجد فيديو عام من الفيديوهات المختارة الآن.',
    recent_uploads: 'انشر فيديو ليظهر هنا.',
    popular_uploads: 'انشر فيديو ليظهر هنا.',
    shorts: 'انشر مقطعًا قصيرًا ليظهر هنا.',
    live_streams: 'لا يوجد بث مباشر أو مجدول.',
    liked_videos: 'لم تُعجب بأي فيديو عام بعد.',
    single_playlist: 'قائمة التشغيل خاصة أو محذوفة أو ليس فيها فيديوهات عامة.',
    multiple_playlists: 'لا توجد قائمة عامة من القوائم المختارة الآن.',
    created_playlists: 'أنشئ قائمة تشغيل عامة لتظهر هنا.',
    featured_channels: 'لا توجد قناة متاحة من القنوات المختارة الآن.',
    subscribed_channels: 'ليس لديك اشتراكات عامة لعرضها.',
    community_posts: 'انشر منشورًا عامًا ليظهر هنا.',
  },
  editSections: 'تعديل الأقسام',
  loadFailedForOwner: 'تعذّر تحميل أقسامك.',
  retry: 'حاول مرة أخرى',
  errors: {
    section_limit: 'يمكنك إضافة ١٢ قسمًا كحد أقصى.',
    section_type_limit: 'هذا القسم موجود في قناتك بالفعل.',
    owner_consent_required: 'يمكن لمالك القناة وحده عرض اشتراكاته أو إعجاباته.',
    consent_required: 'أكّد أنه يمكن للزوار رؤية هذا.',
    invalid_video: 'أحد الفيديوهات المختارة غير متاح. اختر فيديو عامًا.',
    invalid_playlist: 'اختر قائمة تشغيل عامة من هذه القناة.',
    invalid_channel: 'إحدى القنوات المختارة غير متاحة، أو هي هذه القناة.',
    validation_failed: 'راجع إعدادات القسم وحاول مرة أخرى.',
    forbidden: 'لا يمكنك تعديل أقسام هذه القناة.',
    generic: 'تعذّر حفظ القسم. حاول مرة أخرى.',
  },
  form: {
    titleOptional: 'اتركه فارغًا لاستخدام العنوان الافتراضي.',
    titleRequiredHint: 'أعطِ هذا القسم عنوانًا، مثل «علماؤنا».',
    videos: 'الفيديوهات',
    pickVideos: 'اختر الفيديوهات',
    searchVideos: 'ابحث في فيديوهاتك',
    pasteVideo: 'أو الصق رابط فيديو أو معرّفه',
    addPasted: 'إضافة',
    pastedNotFound: 'لم يُعثر على فيديو عام لهذا الرابط.',
    selectedCount: 'تم اختيار {count} من {max}',
    maxReached: 'وصلت إلى الحد الأقصى.',
    noVideos: 'لا توجد فيديوهات عامة.',
    playlists: 'قوائم التشغيل',
    pickPlaylist: 'اختر قائمة تشغيل',
    pickPlaylists: 'اختر قوائم التشغيل',
    noPlaylists: 'لا توجد قوائم تشغيل عامة في هذه القناة بعد.',
    channels: 'القنوات',
    searchChannels: 'ابحث عن القنوات بالاسم أو @المعرّف',
    searchChannelsHint: 'القنوات الأكثر مشاهدة أولًا؛ اكتب اسمًا أو @معرّفًا للبحث.',
    searchPlaylists: 'البحث في قوائم التشغيل',
    noChannelsFound: 'لا توجد قنوات.',
    remove: 'إزالة',
    moveUp: 'تحريك لأعلى',
    moveDown: 'تحريك لأسفل',
    spotlightTrailer: 'مقدمة للزوار الجدد',
    spotlightTrailerHint: 'تظهر لمن لم يشترك بعد.',
    spotlightReturning: 'فيديو مميز للمشتركين',
    spotlightReturningHint: 'يظهر للمشتركين عند عودتهم.',
    spotlightNeedsOne: 'اختر فيديو واحدًا على الأقل.',
    none: 'لا شيء',
    change: 'تغيير',
    sort: 'الترتيب',
    sortLatest: 'الأحدث أولًا',
    sortPopular: 'الأكثر مشاهدة أولًا',
    liveFilter: 'العرض',
    liveAndUpcoming: 'مباشر وقادم',
    pastLive: 'البث السابق',
    postMode: 'العرض',
    postLatest: 'أحدث المنشورات',
    postPinned: 'المنشور المثبّت فقط',
    itemCount: 'عدد العناصر',
    postCount: 'عدد المنشورات',
    consentLabel: 'اعرض هذا للجميع',
    consentSubscriptions: 'سيرى كل من يزور قناتك القنوات التي تشترك فيها.',
    consentLikes: 'سيرى كل من يزور قناتك الفيديوهات التي أعجبتك.',
    consentRequired: 'ضع علامة في المربع لعرض هذا في قناتك.',
    ownerOnlyConsent: 'يمكن لمالك القناة وحده تفعيل هذا.',
    pickRequired: 'اختر عنصرًا واحدًا على الأقل.',
    loading: 'جارٍ التحميل…',
  },
  render: {
    watch: 'شاهد',
    trailer: 'مقدمة القناة',
    forSubscribers: 'للمشتركين',
    seeAllPosts: 'عرض كل المنشورات',
    pinned: 'مثبّت',
    poll: 'استطلاع',
    pollOptions: '{count} خيارات',
    likes: '{count} إعجاب',
    comments: '{count} تعليق',
    live: 'مباشر',
    upcoming: 'قادم',
    videosCount: '{count} فيديو',
  },
};
