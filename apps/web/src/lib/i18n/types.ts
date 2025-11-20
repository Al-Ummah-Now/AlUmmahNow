/**
 * App-wide Internationalization Types
 *
 * Type definitions for the Al Ummah Now i18n system.
 * Ensures type safety and completeness across all translations.
 */

/**
 * Supported languages
 * Import from locales.ts to keep single source of truth
 */
export type { SupportedLocale } from './locales';

/**
 * Keep the old type for backward compatibility
 */
export type SupportedLanguage = 'en' | 'ar';

/**
 * Complete translation structure for the app
 * All translations must implement this interface to ensure completeness
 */
export interface AppTranslations {
  /**
   * Common UI elements
   */
  common: {
    appName: string;
    loading: string;
    error: string;
    success: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    create: string;
    search: string;
    filter: string;
    sort: string;
    close: string;
    back: string;
    next: string;
    previous: string;
    submit: string;
    confirm: string;
    noResults: string;
    viewAll: string;
    learnMore: string;
    retry: string;
    demo: string;
    backTo: string;
    welcome: string;
  };

  /**
   * Languages
   */
  languages: {
    english: string;
    arabic: string;
  };

  /**
   * Header/Navigation
   */
  header: {
    noChannelSelected: string;
    switchAccount: string;
    addAccount: string;
    logout: string;
    logoutAll: string;
    settings: string;
    darkMode: string;
    lightMode: string;
    viewChannel: string;
  };

  /**
   * Navigation menu
   */
  navigation: {
    navigationMenu: string;
    navigation: string;
    accounts: string;
    profile: string;
    analytics: string;
    noChannel: string;
    noActiveChannel: string;
    createChannel: string;
    channelName: string;
    enterChannelName: string;
    addAnotherAccount: string;
    signOutOf: string;
    signOutOfAll: string;
    signIn: string;
    light: string;
    dark: string;
    channel: string;
    channels: string;
  };

  /**
   * Channel related
   */
  channel: {
    myChannels: string;
    selectChannel: string;
    createChannel: string;
    editChannel: string;
    deleteChannel: string;
    channelName: string;
    channelDescription: string;
    channelAvatar: string;
    mainChannel: string;
    subscribers: string;
    videos: string;
    subscribe: string;
    subscribed: string;
    unsubscribe: string;
    manageChannels: string;
    yourChannels: string;
    browseWithoutChannel: string;
    enterChannelNamePlaceholder: string;
    refreshChannelList: string;
    singleChannel: string;
    clickToChangeCover: string;
    clickToChangeAvatar: string;
    updateChannelInformation: string;
    channelNotFoundMessage: string;
    charactersRemaining: string;
    saveChanges: string;
    channelNotFound: string;
    channelNameEnglish: string;
    channelNameArabic: string;
    channelDescriptionEnglish: string;
    channelDescriptionArabic: string;
    channelBanner: string;
    channelTrailer: string;
    noChannelTrailer: string;
    about: string;
    content: string;
    channelSectionsPlaceholder: string;
    description: string;
    noDescription: string;
    statistics: string;
    joined: string;
    links: string;
    twitter: string;
    facebook: string;
    instagram: string;
    channelDetails: string;
    channelId: string;
    category: string;
    tags: string;
    home: string;
    shorts: string;
    live: string;
    playlists: string;
    community: string;
    channels: string;
    manageTabs: string;
    setAsDefault: string;
    hideTab: string;
    showTab: string;
    reorderTabs: string;
    customTab: string;
    addCustomTab: string;
    tabName: string;
    tabContent: string;
    seeAll: string;
    recentUploads: string;
    recentUploadsDescription: string;
    popularUploads: string;
    popularUploadsDescription: string;
    allPlaylists: string;
    allPlaylistsDescription: string;
    featuredVideos: string;
    featuredVideosDescription: string;
    likedVideos: string;
    latestLive: string;
    featuredPlaylists: string;
    featuredPlaylistsDescription: string;
    singlePlaylist: string;
    singlePlaylistDescription: string;
    playlistNotFound: string;
    noPlaylistsFound: string;
    liveNow: string;
    liveNowDescription: string;
    pastLiveStreams: string;
    pastLiveStreamsDescription: string;
    upcomingLiveStreams: string;
    upcomingLiveStreamsDescription: string;
    featuredChannels: string;
    featuredChannelsDescription: string;
    subscriptionsSection: string;
    subscriptionsSectionDescription: string;
    addSection: string;
    configureSection: string;
    addChannelSection: string;
    sectionTitle: string;
    enterSectionTitle: string;
    charactersCount: string;
    playlistIds: string;
    enterOnePlaylistId: string;
    enterPlaylistIds: string;
    enterExactlyOnePlaylistId: string;
    separatePlaylistIds: string;
    channelIds: string;
    enterChannelIds: string;
    separateChannelIds: string;
    automaticContentMessage: string;
    creating: string;
    createSection: string;
    automaticContent: string;
    playlist: string;
    aboutChannel: string;
    forYou: string;
    additionalSettings: string;
    manageSections: string;
    customizeChannelLayout: string;
    communitySettings: string;
    manageCommunityPosts: string;
    channelSettings: string;
    generalSettings: string;
    editChannelDetails: string;
    backToChannel: string;
    tabs: {
      manage_tabs: string;
      manage_tabs_description: string;
      toggle_visibility: string;
      set_as_default: string;
      cannot_hide_last_tab: string;
      default_tab: string;
      visible: string;
      hidden: string;
      save_changes: string;
      changes_saved: string;
      save_failed: string;
      drag_to_reorder: string;
      at_least_one_visible: string;
      default_must_be_visible: string;
    };
  };

  /**
   * Profile related
   */
  profile: {
    myProfile: string;
    createProfile: string;
    editProfile: string;
    displayName: string;
    email: string;
    bio: string;
    avatar: string;
    profileCreated: string;
    profileUpdated: string;
    checkingProfile: string;
    redirectingToProfileCreation: string;
    redirecting: string;
    welcomeMessage: string;
    emailCannotBeChanged: string;
    firstName: string;
    lastName: string;
    yourFirstName: string;
    yourLastName: string;
    displayNameOptional: string;
    displayNameArabic: string;
    displayNameEmpty: string;
    bioOptional: string;
    bioArabic: string;
    privacyNotice: string;
    privacyNoticeText: string;
    welcome: string;
    editInstructions: string;
    myPlaylists: string;
    playlistsDescription: string;
    newPlaylist: string;
    firstPlaylistMessage: string;
    welcomeUser: string;
    editProfileDescription: string;
    noPlaylistsAvailable: string;
  };

  /**
   * Video related
   */
  video: {
    videos: string;
    uploadVideo: string;
    editVideo: string;
    deleteVideo: string;
    videoTitle: string;
    videoDescription: string;
    videoThumbnail: string;
    videoDuration: string;
    videoViews: string;
    videoLikes: string;
    videoComments: string;
    videoShares: string;
    relatedVideos: string;
    watchLater: string;
    addToPlaylist: string;
    noVideoSelected: string;
    selectVideoMessage: string;
    noVideosAvailable: string;
    latest: string;
    popular: string;
    oldest: string;
    views: string;
    view: string;
    today: string;
    yesterday: string;
    daysAgo: string;
    weeksAgo: string;
    monthsAgo: string;
    yearsAgo: string;
  };

  /**
   * Search related
   */
  search: {
    searchPlaceholder: string;
    searchResults: string;
    searchVideos: string;
    searchChannels: string;
    searchPlaylists: string;
    noSearchResults: string;
    recentSearches: string;
    clearSearchHistory: string;
    trending: string;
    searchPageTitle: string;
    searchButton: string;
    searching: string;
    foundResults: string;
    foundResultsFor: string;
    activeFilters: string;
    category: string;
    language: string;
    duration: string;
    dateFrom: string;
    dateTo: string;
    noResultsTitle: string;
    noResultsMessage: string;
    clearFilters: string;
    filters: string;
    active: string;
    applyFilters: string;
    clear: string;
    uploadDate: string;
    sortBy: string;
    allCategories: string;
    islamicLectures: string;
    quranRecitation: string;
    islamicHistory: string;
    prayerGuidance: string;
    islamicStories: string;
    scholarlyDiscussions: string;
    allLanguages: string;
    english: string;
    arabic: string;
    anyDuration: string;
    short: string;
    medium: string;
    long: string;
    relevance: string;
    uploadDateSort: string;
    viewCount: string;
    likes: string;
    descending: string;
    ascending: string;
    trendingVideos: string;
    lastHour: string;
    today: string;
    thisWeek: string;
    thisMonth: string;
    noTrendingVideos: string;
    checkBackLater: string;
  };

  /**
   * Upload related
   */
  upload: {
    uploadTitle: string;
    selectFile: string;
    dragDropFiles: string;
    videoDetails: string;
    uploading: string;
    uploadComplete: string;
    uploadFailed: string;
    uploadProgress: string;
    processingVideo: string;
    preparing: string;
    makePublic: string;
    cancelUpload: string;
    dropHere: string;
    supports: string;
    max: string;
    shareDescription: string;
    videoUploadedMessage: string;
    viewVideo: string;
    uploadAnother: string;
    waitingMessage: string;
    percentComplete: string;
    guidelines: string;
    guidelineIslamicValues: string;
    guidelineMaxSize: string;
    guidelineFormats: string;
    guidelineCopyright: string;
    guidelineProcessing: string;
    guidelineThumbnails: string;
    shareWithCommunity: string;
  };

  /**
   * Analytics related
   */
  analytics: {
    analyticsTitle: string;
    overview: string;
    views: string;
    watchTime: string;
    subscribers: string;
    revenue: string;
    topVideos: string;
    topCountries: string;
    topDevices: string;
    realtimeViews: string;
    last28Days: string;
    last7Days: string;
    today: string;
    demoMode: string;
    demoMessage: string;
    trackPerformance: string;
    demoModeMessage: string;
  };

  /**
   * Time related
   */
  time: {
    allTime: string;
    hours: string;
    minutes: string;
  };

  /**
   * Subscriptions related
   */
  subscriptions: {
    subscriptionsTitle: string;
    mySubscriptions: string;
    manage: string;
    notificationSettings: string;
    subscriptionFeed: string;
    noSubscriptions: string;
    loginToSeeVideos: string;
    latestVideos: string;
    lastUpdated: string;
    refresh: string;
    loadingFeed: string;
    noVideosInFeed: string;
    subscribeToSeeVideos: string;
    discoverChannels: string;
    loadMoreComingSoon: string;
    showingVideosFrom: string;
    wantMore: string;
  };

  /**
   * Feed related
   */
  feed: {
    feedTitle: string;
    home: string;
    trending: string;
    subscriptions: string;
    history: string;
    watchLater: string;
    likedVideos: string;
  };

  /**
   * Moderation related
   */
  moderation: {
    moderationTitle: string;
    reports: string;
    reviewReport: string;
    approve: string;
    reject: string;
    takeAction: string;
    reportReason: string;
    reportStatus: string;
    reportedBy: string;
    reportDate: string;
    moderationDashboard: string;
    dashboardSubtitle: string;
    totalReports: string;
    pendingReports: string;
    allTime: string;
    needsAttention: string;
    actions24h: string;
    recentActivity: string;
    avgResponseTime: string;
    meanResolution: string;
    filterReports: string;
    priority: string;
    contentType: string;
    recentReports: string;
    reportsPendingAction: string;
    noReportsMatch: string;
    accessDenied: string;
    backToDashboard: string;
    reportDetails: string;
    reviewReportMessage: string;
    reportReasonLabel: string;
    descriptionLabel: string;
    reportedByLabel: string;
    reportDateLabel: string;
    assignedToLabel: string;
    resolutionNotesLabel: string;
    reportedContentLabel: string;
    viewOriginalContent: string;
    chooseAction: string;
    takeModerationAction: string;
    alreadyResolved: string;
    actionType: string;
    selectAction: string;
    approveContent: string;
    removeContent: string;
    hideContent: string;
    warnUser: string;
    restrictUser: string;
    banUser: string;
    dismissReport: string;
    flagForReview: string;
    briefReason: string;
    notesOptional: string;
    additionalNotes: string;
    takingAction: string;
    actionHistory: string;
    viewAllReports: string;
    userManagement: string;
    reason: string;
    description: string;
    assignedTo: string;
    status: {
      pending: string;
      inReview: string;
      resolved: string;
      rejected: string;
      escalated: string;
      allStatuses: string;
      dismissed: string;
    };
    priorityEnum: {
      urgent: string;
      high: string;
      medium: string;
      low: string;
      allPriorities: string;
    };
    contentTypeEnum: {
      video: string;
      comment: string;
      channel: string;
      playlist: string;
      allTypes: string;
    };
    reportReasonEnum: {
      inappropriateContent: string;
      spam: string;
      harassment: string;
      violence: string;
      hateSpeech: string;
      falseInformation: string;
      copyright: string;
      privacyViolation: string;
      other: string;
    };
  };

  /**
   * Authentication related
   */
  auth: {
    login: string;
    logout: string;
    signUp: string;
    forgotPassword: string;
    resetPassword: string;
    emailAddress: string;
    password: string;
    confirmPassword: string;
    rememberMe: string;
    loginSuccess: string;
    logoutSuccess: string;
    loginFailed: string;
  };

  /**
   * Error messages
   */
  errors: {
    genericError: string;
    networkError: string;
    notFound: string;
    unauthorized: string;
    forbidden: string;
    serverError: string;
    validationError: string;
    uploadError: string;
    sessionExpired: string;
    uploadFailed: string;
  };

  /**
   * Success messages
   */
  success: {
    saved: string;
    deleted: string;
    uploaded: string;
    updated: string;
    created: string;
  };

  /**
   * Validation messages
   */
  validation: {
    required: string;
    invalidEmail: string;
    invalidUrl: string;
    minLength: string;
    maxLength: string;
    passwordMismatch: string;
  };

  /**
   * Comments related
   */
  comments: {
    commentsCount: string;
    addComment: string;
    cancel: string;
    comment: string;
    commenting: string;
    signInToComment: string;
    signIn: string;
    noComments: string;
    liveUpdates: string;
    live: string;
    offline: string;
  };

  /**
   * Community related
   */
  community: {
    managePosts: string;
    newPost: string;
    searchPosts: string;
    allTypes: string;
    text: string;
    image: string;
    poll: string;
    quiz: string;
    video: string;
    published: string;
    scheduled: string;
    drafts: string;
    noResultsFound: string;
    noPostsYet: string;
    createFirstPost: string;
    community: string;
  };

  /**
   * Notifications related
   */
  notifications: {
    notificationCenter: string;
    new: string;
    view: string;
    markAsRead: string;
    markAllAsRead: string;
    noNotifications: string;
    viewAll: string;
    testNotification: string;
    demoFeatures: string;
    likeNotification: string;
    commentNotification: string;
    subscriptionNotification: string;
    uploadNotification: string;
    systemNotification: string;
    likeMessage: string;
    commentMessage: string;
    subscriptionMessage: string;
    uploadMessage: string;
    systemMessage: string;
  };
}

/**
 * Result type for useI18n hook
 */
export interface UseI18nResult {
  /**
   * Complete translation object for current language
   */
  t: AppTranslations;

  /**
   * Current language code
   */
  lang: SupportedLanguage;

  /**
   * Whether current language is RTL
   */
  isRTL: boolean;

  /**
   * Text direction ('ltr' or 'rtl')
   */
  dir: 'ltr' | 'rtl';
}
