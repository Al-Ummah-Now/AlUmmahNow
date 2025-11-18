/**
 * App-wide Internationalization Types
 *
 * Type definitions for the Al Ummah Now i18n system.
 * Ensures type safety and completeness across all translations.
 */

/**
 * Supported languages
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
