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
    view: string;
    viewAll: string;
    learnMore: string;
    retry: string;
    demo: string;
    backTo: string;
    welcome: string;
    collapse?: string;
    expand?: string;
    loadMore?: string;
    saving?: string;
    saved?: string;
    saveFailed?: string;
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
    home: string;
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
      cannot_hide_default_tab: string;
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
    firstNameArabic: string;
    lastNameArabic: string;
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
    timezone: string;
    timezoneDetected: string;
    currentTimezone: string;
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
    // Video chapters (flat properties)
    chapters?: string;
    chapter?: string;
    noChapters?: string;
    currentChapter?: string;
    nextChapter?: string;
    previousChapter?: string;
    addChapter?: string;
    editChapter?: string;
    deleteChapter?: string;
    chapterTitle?: string;
    chapterTimestamp?: string;
    parseFromDescription?: string;
    showChapters?: string;
    hideChapters?: string;
    chapterList?: string;
    parseChapters?: string;
    chapterParserHelp?: string;
    chapterParserExample?: string;
    chaptersDetected?: string;
    chaptersParsed?: string;
    invalidChapterFormat?: string;
    firstChapterMustBeZero?: string;
    chapterTooClose?: string;
    maxChaptersReached?: string;
    duplicateTimestamp?: string;
    chapterTitleRequired?: string;
    chapterTitleMaxLength?: string;
    moveChapterUp?: string;
    moveChapterDown?: string;
    previewChapters?: string;
    autoParseChapters?: string;
    manualChapters?: string;
    importedChapters?: string;
    // Video management dashboard
    myVideos?: string;
    manageVideos?: string;
    manageVideosDescription?: string;
    videoManagement?: string;
    allVideos?: string;
    uploadedVideos?: string;
    searchVideos?: string;
    filterByStatus?: string;
    filterByPrivacy?: string;
    sortVideos?: string;
    allStatus?: string;
    ready?: string;
    processing?: string;
    uploading?: string;
    failed?: string;
    public?: string;
    private?: string;
    makePublic?: string;
    makePrivate?: string;
    sortByDate?: string;
    sortByViews?: string;
    sortByTitle?: string;
    bulkActions?: string;
    selectAll?: string;
    deselectAll?: string;
    deleteSelected?: string;
    changePrivacy?: string;
    videosSelected?: string;
    confirmDelete?: string;
    confirmDeleteTitle?: string;
    confirmDeleteMultiple?: string;
    confirmDeleteMultipleTitle?: string;
    deleteSuccess?: string;
    deleteMultipleSuccess?: string;
    noVideosFound?: string;
    uploadFirstVideo?: string;
    // Video Edit
    editVideoDetails?: string;
    videoPreview?: string;
    titleEnglish?: string;
    titleArabic?: string;
    descriptionEnglish?: string;
    descriptionArabic?: string;
    thumbnailSelector?: string;
    autoGeneratedThumbnails?: string;
    customThumbnail?: string;
    uploadThumbnail?: string;
    selectThumbnail?: string;
    dragDropThumbnail?: string;
    thumbnailRequirements?: string;
    setAsDefault?: string;
    currentThumbnail?: string;
    videoTags?: string;
    addTag?: string;
    enterTag?: string;
    removeTag?: string;
    videoCategory?: string;
    selectCategory?: string;
    videoLanguage?: string;
    videoPrivacy?: string;
    publicVideo?: string;
    privateVideo?: string;
    saveChanges?: string;
    saving?: string;
    discardChanges?: string;
    unsavedChanges?: string;
    unsavedChangesMessage?: string;
    leaveWithoutSaving?: string;
    continueEditing?: string;
    updateSuccess?: string;
    updateFailed?: string;
    thumbnailUploadSuccess?: string;
    thumbnailUploadFailed?: string;
    thumbnailInvalidType: string;
    thumbnailTooLarge: string;
    thumbnailCurrentDefault: string;
    enterTitleEnglish: string;
    enterDescriptionEnglish: string;
    enterTitleArabic: string;
    enterDescriptionArabic: string;
    createChaptersManually: string;
    uploadChapterFile: string;
    clickToEditChapters: string;
    // Video player controls
    play?: string;
    pause?: string;
    mute?: string;
    unmute?: string;
    fullscreen?: string;
    exitFullscreen?: string;
    quality?: string;
    speed?: string;
    currentTime?: string;
    totalDuration?: string;
    // Video duration filters
    shortVideos?: string;
    standardVideos?: string;
    longVideos?: string;
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
    uploadVideo: string;
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
    // TUS upload states
    paused: string;
    processing: string;
    complete: string;
    failed: string;
    pause: string;
    resume: string;
    cancel: string;
    retry: string;
    speed: string;
    timeRemaining: string;
    bytesUploaded: string;
  };

  /**
   * Batch upload related
   */
  batch: {
    batchUpload: string;
    selectFiles: string;
    selectedFiles: string;
    filesSelected: string;
    dragDropMultiple: string;
    clickToBrowse: string;
    fileLimit: string;
    removeFile: string;
    sharedMetadata: string;
    individualMetadata: string;
    applyToAll: string;
    copyToAll: string;
    resetToShared: string;
    autoNumbering: string;
    enableAutoNumbering: string;
    numberingPattern: string;
    uploadQueue: string;
    queueEmpty: string;
    addVideos: string;
    startUploads: string;
    pauseAll: string;
    resumeAll: string;
    cancelAll: string;
    retryFailed: string;
    overallProgress: string;
    completed: string;
    pending: string;
    uploading: string;
    paused: string;
    cancelled: string;
    eta: string;
    overallEta: string;
    concurrency: string;
    concurrentUploads: string;
    uploadSpeed: string;
    totalProgress: string;
    ofCompleted: string;
    errors: {
      tooFewFiles: string;
      tooManyFiles: string;
      invalidFileType: string;
      fileTooLarge: string;
      initiateFailed: string;
      deviceLimit: string;
      uploadFailed: string;
    };
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
    /** Analytics dashboard labels */
    dashboard: {
      noData: string;
      signInTitle: string;
      signInMessage: string;
      totalViews: string;
      totalLikes: string;
      totalComments: string;
      totalVideos: string;
      publishedContent: string;
      avgViewsPerVideo: string;
      performanceIndicator: string;
      engagementOverview: string;
      overallEngagementRate: string;
      topPerformingVideo: string;
      topPerformingVideos: string;
      viewsCount: string;
      likesAndComments: string;
      performanceTrends: string;
      viewsOverTime: string;
      engagementMetrics: string;
      likes: string;
      comments: string;
      avgDailyViews: string;
      noMetrics: string;
      changeVsPrevious: string;
    };
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
    loadMore: string;
    loadFailed: string;
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
    notFoundDescription: string;
    unauthorized: string;
    forbidden: string;
    serverError: string;
    validationError: string;
    uploadError: string;
    sessionExpired: string;
    uploadFailed: string;
    authRequired: string;
    channelRequired: string;
    failedToLoad: string;
    failedToSave: string;
    failedToDelete: string;
    failedToUpdate: string;
    failedToCreate: string;
    failedToSwitch: string;
    failedToProcess: string;
    invalidFile: string;
    fileTooLarge: string;
    reportReasonRequired: string;
    loginRequired: string;
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
    like: string;
    dislike: string;
    deleteComment: string;
    confirmDelete: string;
    edited: string;
    unknownAuthor: string;
    loadMore: string;
    loading: string;
    loadFailed: string;
    actionFailed: string;
    yourAvatar: string;
    authorAvatar: string;
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
    // Channel community feed
    noPostsDescription: string;
    loadPostsFailed: string;
    retry: string;
    loadMore: string;
    loading: string;
    like: string;
    unlike: string;
    // Polls
    vote: string;
    voting: string;
    voteCountOne: string;
    voteCountMany: string;
    votingEnded: string;
    votingEnds: string;
    signInToVote: string;
    voteFailed: string;
    pollOption: string;
    // Comment moderation (channel owner)
    pinComment: string;
    unpinComment: string;
    pinned: string;
    heartComment: string;
    removeHeart: string;
    heartedByCreator: string;
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
    /** Server-pushed notifications, keyed by NotificationEvent.notificationKey */
    realtime: {
      newCommentTitle: string;
      newCommentMessage: string;
      newSubscriberTitle: string;
      newSubscriberMessage: string;
      uploadReadyTitle: string;
      uploadReadyMessage: string;
      uploadFailedTitle: string;
      uploadFailedMessage: string;
    };
  };

  /**
   * Subtitles/Captions related
   */
  subtitle: {
    title: string;
    subtitles: string;
    subtitlesDescription: string;
    upload: string;
    language: string;
    default: string;
    delete: string;
    settings: string;
    fontSize: string;
    off: string;
    preview: string;
    showingFirst5: string;
    warnings: string;
    moreCues: string;
    noIssues: string;
    uploadSubtitle: string;
    selectLanguage: string;
    chooseLanguage: string;
    selectFile: string;
    subtitleFile: string;
    uploadProgress: string;
    uploading: string;
    uploadSuccess: string;
    uploadError: string;
    uploadFailed: string;
    setAsDefault: string;
    setDefault: string;
    fileSize: string;
    status: string;
    uploadedAt: string;
    actions: string;
    noSubtitles: string;
    noSubtitlesDescription: string;
    uploadFirstSubtitle: string;
    addSubtitle: string;
    validationErrors: string;
    validating: string;
    validationFailed: string;
    completeAllFields: string;
    dragDropOrClick: string;
    supportedFormats: string;
    uploadFileArea: string;
    confirmDelete: string;
    confirmDeleteDescription: string;
    deleteSubtitle: string;
    statusActive: string;
    statusProcessing: string;
    statusFailed: string;
  };

  /**
   * Playlists (playlist page, management, save-to-playlist)
   */
  playlist: {
    playlist: string;
    playlists: string;
    playAll: string;
    videosLabel: string;
    videoCount: string;
    emptyPlaylist: string;
    notFound: string;
    notFoundDescription: string;
    publicLabel: string;
    privateLabel: string;
    updatedOn: string;
    removeFromPlaylist: string;
    moveUp: string;
    moveDown: string;
    removeFailed: string;
    reorderFailed: string;
    managePlaylists: string;
    managePlaylistsDescription: string;
    newPlaylist: string;
    createPlaylist: string;
    editPlaylist: string;
    deletePlaylist: string;
    confirmDelete: string;
    nameLabel: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    visibilityLabel: string;
    publicDescription: string;
    privateDescription: string;
    nameRequired: string;
    createFailed: string;
    updateFailed: string;
    deleteFailed: string;
    loadFailed: string;
    noPlaylists: string;
    viewPlaylist: string;
    saveToPlaylist: string;
    saveToPlaylistTitle: string;
    addedTo: string;
    removedFrom: string;
    saveFailed: string;
    createAndAdd: string;
    channelRequired: string;
  };

  /**
   * Video Sections related
   */
  sections?: {
    // Video Sections
    recentVideos?: string;
    popularVideos?: string;
    trendingVideos?: string;
    recommendedVideos?: string;
    noRecentVideos?: string;
    noPopularVideos?: string;
    noTrendingVideos?: string;
    noRecommendedVideos?: string;
    // Time Periods
    periodDaily?: string;
    periodWeekly?: string;
    periodMonthly?: string;
    periodAll?: string;
    // Strategies
    strategyPopular?: string;
    strategyCategoryBased?: string;
    strategyRandom?: string;
    basedOn?: string;
    // Common
    loadMore?: string;
    collapse?: string;
    expand?: string;
  };

  /**
   * Upload Defaults/Templates related
   */
  uploadDefaults?: {
    title?: string;
    subtitle?: string;
    createTemplate?: string;
    createFirstTemplate?: string;
    noTemplates?: string;
    noTemplatesMessage?: string;
    templateName?: string;
    templateNameEnglish?: string;
    templateNameArabic?: string;
    templateDescription?: string;
    templateDescriptionPlaceholder?: string;
    setAsDefault?: string;
    defaultBadge?: string;
    category?: string;
    selectCategory?: string;
    used?: string;
    times?: string;
    createNewTemplate?: string;
    editTemplate?: string;
    deleteTemplate?: string;
    confirmDelete?: string;
    deleteSuccess?: string;
    deleteFailed?: string;
    setDefaultSuccess?: string;
    setDefaultFailed?: string;
    // Template Editor
    templateInformation?: string;
    templateNameRequired?: string;
    titleRequired?: string;
    videoMetadata?: string;
    titleEnglish?: string;
    titleArabic?: string;
    descriptionEnglish?: string;
    descriptionArabic?: string;
    useVariables?: string;
    useVariablesArabic?: string;
    tags?: string;
    tagsPlaceholder?: string;
    tagsExample?: string;
    visibility?: string;
    public?: string;
    private?: string;
    unlisted?: string;
    language?: string;
    english?: string;
    arabic?: string;
    saving?: string;
    saveFailed?: string;
    saveError?: string;
    // Template Selector
    uploadTemplate?: string;
    noneManualEntry?: string;
    defaultTemplate?: string;
    templateApplied?: string;
    loadTemplatesFailed?: string;
    loadTemplatesError?: string;
    // Variable Prompts
    enterVariableValues?: string;
    templateRequiresInputs?: string;
    episodeNumber?: string;
    episodeNumberPlaceholder?: string;
    seasonNumber?: string;
    seasonNumberPlaceholder?: string;
    seriesName?: string;
    seriesNamePlaceholder?: string;
    partNumber?: string;
    partNumberPlaceholder?: string;
    surahName?: string;
    surahNamePlaceholder?: string;
    ayahRange?: string;
    ayahRangePlaceholder?: string;
    juzNumber?: string;
    juzNumberPlaceholder?: string;
    // Variable Guide
    variableGuide?: string;
    variables?: string;
    requiresInput?: string;
    example?: string;
    copy?: string;
    copied?: string;
    variableUsageNote?: string;
    // Variable Categories
    categoryDateTime?: string;
    categoryIslamic?: string;
    categoryEpisode?: string;
    categoryQuran?: string;
    categoryChannel?: string;
    categoryVideo?: string;
  };

  /**
   * Scheduling related
   */
  schedule?: {
    title?: string;
    schedulingOptions?: string;
    publishImmediately?: string;
    scheduleLater?: string;
    selectDate?: string;
    selectTime?: string;
    selectDateTime?: string;
    timezone?: string;
    selectTimezone?: string;
    notifyOnPublish?: string;
    schedulePreview?: string;
    willBePublishedOn?: string;
    minimumScheduleTime?: string;
    maximumScheduleTime?: string;
    scheduled?: string;
    cancel?: string;
    publishNow?: string;
    scheduledVideos?: string;
    noScheduledVideos?: string;
    scheduleVideo?: string;
    reschedule?: string;
    cancelSchedule?: string;
    editSchedule?: string;
    scheduledFor?: string;
    myScheduledVideos?: string;
    noScheduledVideosMessage?: string;
    videoWillBePublished?: string;
    atTime?: string;
    inYourTimezone?: string;
    goesLiveIn?: string;
    dateAndTime?: string;
    invalidScheduleTime?: string;
    scheduleConflict?: string;
    scheduleSuccess?: string;
    scheduleFailed?: string;
    scheduleUpdated?: string;
    scheduleCancelled?: string;
    publishingNow?: string;
    publishedSuccessfully?: string;
    statusScheduled?: string;
    statusPublishing?: string;
    statusPublished?: string;
    statusFailed?: string;
    statusCancelled?: string;
    filterByStatus?: string;
    allStatuses?: string;
    sortByDate?: string;
    oldestFirst?: string;
    newestFirst?: string;
    viewVideo?: string;
    editVideo?: string;
    deleteVideo?: string;
    timeRemaining?: string;
    publishesIn?: string;
    publishesSoon?: string;
    days?: string;
    hours?: string;
    minutes?: string;
    seconds?: string;
    createFirstScheduledVideo?: string;
    scheduleAVideo?: string;
    confirmCancelSchedule?: string;
    confirmPublishNow?: string;
    localTime?: string;
    utcTime?: string;
    // Calendar View
    views?: {
      list: string;
      calendar: string;
    };
    calendar?: {
      month: string;
      week: string;
      day: string;
      today: string;
      previous: string;
      next: string;
      calendarType: string;
      gregorian: string;
      hijri: string;
      noEvents: string;
      scheduledFor: string;
      loadingEvents?: string;
      errorLoadingEvents?: string;
      unknownError?: string;
      noScheduledVideos?: string;
      noScheduledVideosThisPeriod?: string;
    };
    hijriMonths?: {
      1: string;
      2: string;
      3: string;
      4: string;
      5: string;
      6: string;
      7: string;
      8: string;
      9: string;
      10: string;
      11: string;
      12: string;
    };
  };

  /**
   * Live streaming page related
   */
  live?: {
    liveStreams?: string;
    liveStreamsDescription?: string;
    failedToLoadStreams?: string;
    failedToLoadStreamsDescription?: string;
    tryAgain?: string;
    noLiveStreams?: string;
    noLiveStreamsDescription?: string;
    updatingLiveStreams?: string;
    showingStreamsCount?: string;
  };

  /**
   * Settings page related
   */
  /**
   * Report content dialog
   */
  reportContent: {
    report: string;
    title: string;
    reporting: string;
    whyReporting: string;
    selectReason: string;
    pleaseSpecify: string;
    briefDescription: string;
    additionalDetails: string;
    additionalDetailsPlaceholder: string;
    charactersCount: string;
    reviewNotice: string;
    submit: string;
    submitting: string;
    cancel: string;
    close: string;
    thankYou: string;
    failed: string;
    alreadyReported: string;
    reasons: {
      inappropriate: string;
      spam: string;
      harassment: string;
      copyright: string;
      misinformation: string;
      other: string;
    };
  };

  /**
   * Watch history page
   */
  watchHistory: {
    title: string;
    subtitle: string;
    signInRequired: string;
    empty: string;
    emptyDescription: string;
    browseVideos: string;
    clearAll: string;
    clearing: string;
    confirmClear: string;
    remove: string;
    lastWatched: string;
    percentWatched: string;
    completed: string;
    loadMore: string;
    loadFailed: string;
    removeFailed: string;
    clearFailed: string;
    totalCount: string;
  };

  settings?: {
    uploadDefaults?: string;
    uploadDefaultsDesc?: string;
    channelSettings?: string;
    channelSettingsDesc?: string;
    profileSettings?: string;
    profileSettingsDesc?: string;
    settingsDescription?: string;
    notAvailable?: string;
    needHelp?: string;
    needHelpDesc?: string;
  };
  /**
   * Discovery: videos/channels directories and channel discovery sections
   */
  discovery: {
    allVideos: string;
    allVideosDescription: string;
    allChannels: string;
    allChannelsDescription: string;
    noVideos: string;
    noVideosDescription: string;
    noChannels: string;
    noChannelsDescription: string;
    loadFailed: string;
    subscribersCount: string;
    videosCount: string;
    verified: string;
    upcomingEventsEmpty: string;
    liveEventsEmpty: string;
    completedEventsEmpty: string;
    featuredChannelsEmpty: string;
    subscriptionsEmpty: string;
    channelsTabEmpty: string;
  };
  /**
   * Accessibility: skip links, landmark labels and accessible names for
   * icon-only controls (Epic 1 - WCAG 2.1 AA)
   */
  a11y: {
    skipLinks: string;
    skipToMainContent: string;
    skipToVideoPlayer: string;
    skipToComments: string;
    openNavigationMenu: string;
    closeNavigationMenu: string;
    goToHomePage: string;
    videoPlayerFor: string;
    channelAvatar: string;
    videoStats: string;
    commentsCount: string;
    likeVideo: string;
    unlikeVideo: string;
    dislikeVideo: string;
    removeDislike: string;
    signInToReact: string;
    watchingNow: string;
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

/**
 * Extended result type for useI18nApi hook with loading states
 */
export interface UseI18nResultExtended extends UseI18nResult {
  /**
   * Whether translations are being loaded for the first time
   */
  isLoading: boolean;

  /**
   * Whether translations are being refetched in the background
   */
  isFetching: boolean;

  /**
   * Whether translations were fetched from API (not static fallback)
   */
  isFromApi: boolean;

  /**
   * Error if API fetch failed
   */
  error: Error | null;
}
