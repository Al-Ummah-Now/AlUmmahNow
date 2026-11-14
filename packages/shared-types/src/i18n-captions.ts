/**
 * Caption drafts in Studio (AUN-CAPTIONS §3.1, §3.3), en/ar. Shared by the web static fallback and
 * the api-videos translation seed, like i18n-upload-status.ts.
 * Placeholders: {count}, {language}, {time}, {list}.
 */

export interface CaptionsTranslations {
  draftsTitle: string;
  /** Drafts are private until published */
  draftsHint: string;
  origin: { review_transcript: string; transcription: string; translation: string };
  status: { draft: string; published: string; outdated: string };
  /** {count} Quran suggestions not confirmed yet */
  quranPending: string;
  edit: string;
  publish: string;
  deleteDraft: string;
  deleteTitle: string;
  deleteBody: string;
  replaceUploadTitle: string;
  /** {language} */
  replaceUploadBody: string;
  replace: string;
  published: string;
  publishFailed: string;
  deleteFailed: string;
  loadFailed: string;
  /** The draft changed elsewhere since it was opened */
  conflict: string;
  reload: string;
  /** Claiming the video review's automatic transcript as a draft (#1296) */
  claim: {
    title: string;
    body: string;
    languageLabel: string;
    action: string;
    /** {language} */
    preparing: string;
    replaceTitle: string;
    /** {language} */
    replaceBody: string;
    failed: { transcript_gone: string; draft_exists: string; failed: string };
    tryAgain: string;
    requestFailed: string;
  };
  /** Transcribing a video on request (§3.1, caption minutes) */
  jobs: {
    title: string;
    body: string;
    languageLabel: string;
    action: string;
    confirmTitle: string;
    /** {minutes} {remaining} */
    cost: string;
    /** {minutes}: no monthly limit */
    costUnlimited: string;
    /** The video's length isn't known yet */
    notReady: string;
    /** {used} {limit} {date} */
    meter: string;
    meterUnlimited: string;
    /** Accessible name of the meter */
    meterLabel: string;
    /** {count} minutes left on extra grants */
    meterPacks: string;
    meterWarning: string;
    /** 402 or a cost above what is left: {minutes} {remaining} {date} */
    notEnough: string;
    noPlan: string;
    contact: string;
    replaceTitle: string;
    /** {language} */
    replaceBody: string;
    step: {
      queued: string;
      waiting_budget: string;
      extracting: string;
      /** {done} {total} */
      transcribing: string;
      transcribingStart: string;
      postprocessing: string;
    };
    /** {language}: {step} */
    chip: string;
    waitingBudgetHint: string;
    cancel: string;
    cancelTitle: string;
    cancelBody: string;
    cancelConfirm: string;
    keep: string;
    cancelled: string;
    finishing: string;
    /** {language} */
    ready: string;
    failed: { audio_unavailable: string; transcription_failed: string; no_speech: string; draft_exists: string; video_gone: string; failed: string };
    /** {minutes} */
    refunded: string;
    tryAgain: string;
    paused: string;
    requestFailed: string;
    cancelFailed: string;
  };
  editor: {
    /** {language} */
    title: string;
    banner: string;
    saved: string;
    saving: string;
    unsaved: string;
    saveFailed: string;
    retry: string;
    close: string;
    undo: string;
    redo: string;
    find: string;
    replaceWith: string;
    replaceAll: string;
    /** {count} */
    replaced: string;
    /** {count} */
    confirmAll: string;
    mergeNext: string;
    split: string;
    deleteCue: string;
    /** Labels of the two nudge groups */
    start: string;
    end: string;
    startEarlier: string;
    startLater: string;
    endEarlier: string;
    endLater: string;
    /** {time} */
    playFrom: string;
    cueText: string;
    /** Accessible name of the cue list */
    cueList: string;
    empty: string;
    /** Publish from the editor: the saved version is published */
    publishSaved: string;
  };
  quran: {
    label: string;
    suggested: string;
    possible: string;
    confirmed: string;
    basmala: string;
    accept: string;
    notQuran: string;
    changeRef: string;
    applyRef: string;
    cancel: string;
    refLabel: string;
    refPlaceholder: string;
    refInvalid: string;
    refChecking: string;
    /** {list} */
    appearsIn: string;
    checkOnQuranCom: string;
    officialText: string;
    unconfirmedHint: string;
    textUnavailable: string;
    attribution: string;
  };
}

export const CAPTIONS_EN: CaptionsTranslations = {
  draftsTitle: 'Caption drafts',
  draftsHint: 'Only you and your channel team see a draft. Viewers see it once you publish it.',
  origin: {
    review_transcript: 'From the automatic transcript',
    transcription: 'Automatic transcription',
    translation: 'Automatic translation',
  },
  status: { draft: 'Draft', published: 'Published', outdated: 'Edited since publishing' },
  quranPending: '{count} Quran suggestions to check',
  edit: 'Edit',
  publish: 'Publish',
  deleteDraft: 'Delete draft',
  deleteTitle: 'Delete this draft?',
  deleteBody: 'The draft and your edits are deleted. Subtitles you already published stay until you delete them.',
  replaceUploadTitle: 'Replace your uploaded subtitles?',
  replaceUploadBody: 'Publishing this draft replaces the {language} subtitles you uploaded.',
  replace: 'Replace',
  published: 'Published. Viewers now see these subtitles.',
  publishFailed: "Couldn't publish the draft. Try again.",
  deleteFailed: "Couldn't delete the draft. Try again.",
  loadFailed: "Couldn't load the caption drafts.",
  conflict: 'This draft was changed in another window. Reload it to continue.',
  reload: 'Reload',
  claim: {
    title: 'Automatic transcript',
    body: 'Your video was transcribed automatically when it was checked. Use the transcript as a caption draft, check it and publish it. Quran in it is shown as the official text once you confirm it.',
    languageLabel: 'Language spoken in the video',
    action: 'Use as caption draft',
    preparing: 'Preparing the {language} draft…',
    replaceTitle: 'Replace your draft?',
    replaceBody: 'You already have a {language} draft. Using the automatic transcript replaces it and your edits.',
    failed: {
      transcript_gone: 'The automatic transcript is no longer available.',
      draft_exists: 'A draft in this language already exists.',
      failed: "Couldn't prepare the draft. Our team has been told.",
    },
    tryAgain: 'Try again',
    requestFailed: "Couldn't start the draft. Try again.",
  },
  jobs: {
    title: 'Transcribe this video',
    body: 'Get captions from what is said in the video. You get a draft to check and publish, and Quran in it is shown as the official text once you confirm it.',
    languageLabel: 'Language spoken in the video',
    action: 'Transcribe',
    confirmTitle: 'Transcribe this video?',
    cost: 'This uses {minutes} of your {remaining} remaining caption minutes.',
    costUnlimited: 'This uses {minutes} caption minutes. Your plan has no monthly limit.',
    notReady: 'You can transcribe the video once it has finished processing.',
    meter: 'Caption minutes: {used} / {limit} this month · resets {date}',
    meterUnlimited: 'Caption minutes: no monthly limit',
    meterLabel: 'Caption minutes used this month',
    meterPacks: '+{count} extra minutes',
    meterWarning: "You've used most of this month's caption minutes.",
    notEnough: 'Transcribing this video takes {minutes} caption minutes and you have {remaining} left. Your minutes reset on {date}.',
    noPlan: "Your plan doesn't include caption minutes.",
    contact: 'Ask our team for more minutes',
    replaceTitle: 'Replace your draft?',
    replaceBody: 'You already have a {language} draft. The new transcript replaces it and your edits.',
    step: {
      queued: 'Waiting to start',
      waiting_budget: 'Waiting',
      extracting: 'Preparing audio',
      transcribing: 'Transcribing {done}/{total}',
      transcribingStart: 'Transcribing',
      postprocessing: 'Checking Quran',
    },
    chip: '{language}: {step}',
    waitingBudgetHint: "Today's transcription capacity is used up. It will start on its own tomorrow.",
    cancel: 'Cancel',
    cancelTitle: 'Cancel the transcription?',
    cancelBody: 'The caption minutes it holds come back to you.',
    cancelConfirm: 'Cancel transcription',
    keep: 'Keep transcribing',
    cancelled: 'Transcription cancelled. The minutes are back.',
    finishing: "It's almost done: the draft is being written, so it can't be cancelled now.",
    ready: 'The {language} draft is ready to check.',
    failed: {
      audio_unavailable: "We couldn't get the audio of this video.",
      transcription_failed: "The transcription didn't work.",
      no_speech: 'No speech was found in this video.',
      draft_exists: 'A draft in this language already exists.',
      video_gone: 'This video is no longer available.',
      failed: "The transcription didn't work. Our team has been told.",
    },
    refunded: 'Your {minutes} caption minutes were given back.',
    tryAgain: 'Try again',
    paused: 'Transcription is paused right now. Try again later.',
    requestFailed: "Couldn't start the transcription. Try again.",
    cancelFailed: "Couldn't cancel the transcription. Try again.",
  },
  editor: {
    title: 'Edit {language} captions',
    banner: "Viewers don't see this draft until you publish it.",
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved changes',
    saveFailed: "Couldn't save your changes.",
    retry: 'Try again',
    close: 'Close',
    undo: 'Undo',
    redo: 'Redo',
    find: 'Find',
    replaceWith: 'Replace with',
    replaceAll: 'Replace all',
    replaced: '{count} replaced',
    confirmAll: 'Confirm all suggested ({count})',
    mergeNext: 'Merge with next',
    split: 'Split at cursor',
    deleteCue: 'Delete caption',
    start: 'Start',
    end: 'End',
    startEarlier: 'Start 0.1 s earlier',
    startLater: 'Start 0.1 s later',
    endEarlier: 'End 0.1 s earlier',
    endLater: 'End 0.1 s later',
    playFrom: 'Play from {time}',
    cueText: 'Caption text',
    cueList: 'Captions',
    empty: 'This draft has no captions.',
    publishSaved: 'Publish',
  },
  quran: {
    label: 'Quran',
    suggested: 'Suggested',
    possible: 'Possible Quran',
    confirmed: 'Confirmed',
    basmala: 'Basmala',
    accept: 'Confirm',
    notQuran: 'Not Quran',
    changeRef: 'Different reference',
    applyRef: 'Use this reference',
    cancel: 'Cancel',
    refLabel: 'Surah and ayah',
    refPlaceholder: 'e.g. 3:166 or 3:166-167',
    refInvalid: 'Enter a surah and ayah, like 3:166 or 3:166-167.',
    refChecking: 'Checking…',
    appearsIn: 'These words also appear in {list}',
    checkOnQuranCom: 'Check on quran.com',
    officialText: 'Official text',
    unconfirmedHint: 'Until you confirm it, viewers see the reference with a quran.com link, not the text.',
    textUnavailable: "The official text isn't available right now. Viewers see the reference.",
    attribution: 'Quran text: Quran Foundation (quran.com)',
  },
};

export const CAPTIONS_AR: CaptionsTranslations = {
  draftsTitle: 'مسودات الترجمة',
  draftsHint: 'لا يرى المسودة إلا أنت وفريق قناتك، ويراها المشاهدون بعد نشرها.',
  origin: {
    review_transcript: 'من النص التلقائي',
    transcription: 'تفريغ تلقائي',
    translation: 'ترجمة تلقائية',
  },
  status: { draft: 'مسودة', published: 'منشورة', outdated: 'عُدّلت بعد النشر' },
  quranPending: '{count} من اقتراحات القرآن بحاجة إلى مراجعة',
  edit: 'تعديل',
  publish: 'نشر',
  deleteDraft: 'حذف المسودة',
  deleteTitle: 'حذف هذه المسودة؟',
  deleteBody: 'ستُحذف المسودة وتعديلاتك. وتبقى الترجمة المنشورة حتى تحذفها.',
  replaceUploadTitle: 'استبدال الترجمة التي رفعتها؟',
  replaceUploadBody: 'نشر هذه المسودة يستبدل ترجمة {language} التي رفعتها.',
  replace: 'استبدال',
  published: 'تم النشر. يرى المشاهدون هذه الترجمة الآن.',
  publishFailed: 'تعذّر نشر المسودة. حاول مرة أخرى.',
  deleteFailed: 'تعذّر حذف المسودة. حاول مرة أخرى.',
  loadFailed: 'تعذّر تحميل مسودات الترجمة.',
  conflict: 'عُدّلت هذه المسودة في نافذة أخرى. أعد تحميلها للمتابعة.',
  reload: 'إعادة التحميل',
  claim: {
    title: 'النص التلقائي',
    body: 'فُرِّغ مرئيك تلقائيًا عند فحصه. استخدم النص مسودةً للترجمة، وراجعه ثم انشره. ويظهر القرآن فيه بالنص الرسمي بعد أن تؤكده.',
    languageLabel: 'لغة الكلام في المرئي',
    action: 'استخدامه مسودةً للترجمة',
    preparing: 'جارٍ تجهيز مسودة {language}…',
    replaceTitle: 'استبدال مسودتك؟',
    replaceBody: 'لديك مسودة {language} بالفعل. استخدام النص التلقائي يستبدلها مع تعديلاتك.',
    failed: {
      transcript_gone: 'لم يعد النص التلقائي متاحًا.',
      draft_exists: 'توجد مسودة بهذه اللغة بالفعل.',
      failed: 'تعذّر تجهيز المسودة، وأُبلغ فريقنا.',
    },
    tryAgain: 'حاول مرة أخرى',
    requestFailed: 'تعذّر بدء المسودة. حاول مرة أخرى.',
  },
  jobs: {
    title: 'تفريغ هذا المرئي',
    body: 'احصل على ترجمة مما يُقال في المرئي. تصلك مسودة تراجعها ثم تنشرها، ويظهر القرآن فيها بالنص الرسمي بعد أن تؤكده.',
    languageLabel: 'لغة الكلام في المرئي',
    action: 'تفريغ',
    confirmTitle: 'تفريغ هذا المرئي؟',
    cost: 'يستهلك هذا {minutes} من دقائق الترجمة، ويبقى لك {remaining} منها.',
    costUnlimited: 'يستهلك هذا {minutes} من دقائق الترجمة. ليس لخطتك حد شهري.',
    notReady: 'يمكنك تفريغ المرئي بعد انتهاء معالجته.',
    meter: 'دقائق الترجمة: {used} من {limit} هذا الشهر · تتجدد في {date}',
    meterUnlimited: 'دقائق الترجمة: بلا حد شهري',
    meterLabel: 'دقائق الترجمة المستهلكة هذا الشهر',
    meterPacks: '+{count} من الدقائق الإضافية',
    meterWarning: 'استهلكت معظم دقائق الترجمة لهذا الشهر.',
    notEnough: 'يحتاج تفريغ هذا المرئي إلى {minutes} من دقائق الترجمة، ويبقى لك {remaining} منها. تتجدد دقائقك في {date}.',
    noPlan: 'لا تشمل خطتك دقائق للترجمة.',
    contact: 'اطلب دقائق إضافية من فريقنا',
    replaceTitle: 'استبدال مسودتك؟',
    replaceBody: 'لديك مسودة {language} بالفعل. التفريغ الجديد يستبدلها مع تعديلاتك.',
    step: {
      queued: 'في انتظار البدء',
      waiting_budget: 'في الانتظار',
      extracting: 'جارٍ تجهيز الصوت',
      transcribing: 'جارٍ التفريغ {done}/{total}',
      transcribingStart: 'جارٍ التفريغ',
      postprocessing: 'جارٍ التحقق من القرآن',
    },
    chip: '{language}: {step}',
    waitingBudgetHint: 'استُنفدت طاقة التفريغ لهذا اليوم. سيبدأ تلقائيًا غدًا.',
    cancel: 'إلغاء',
    cancelTitle: 'إلغاء التفريغ؟',
    cancelBody: 'تعود إليك دقائق الترجمة المحجوزة له.',
    cancelConfirm: 'إلغاء التفريغ',
    keep: 'متابعة التفريغ',
    cancelled: 'أُلغي التفريغ وعادت الدقائق إليك.',
    finishing: 'أوشك على الانتهاء: تُكتب المسودة الآن، فلا يمكن إلغاؤه.',
    ready: 'مسودة {language} جاهزة للمراجعة.',
    failed: {
      audio_unavailable: 'تعذّر الحصول على صوت هذا المرئي.',
      transcription_failed: 'لم ينجح التفريغ.',
      no_speech: 'لم يُعثر على كلام في هذا المرئي.',
      draft_exists: 'توجد مسودة بهذه اللغة بالفعل.',
      video_gone: 'لم يعد هذا المرئي متاحًا.',
      failed: 'لم ينجح التفريغ، وأُبلغ فريقنا.',
    },
    refunded: 'أُعيدت إليك {minutes} من دقائق الترجمة.',
    tryAgain: 'حاول مرة أخرى',
    paused: 'التفريغ متوقف حاليًا. حاول لاحقًا.',
    requestFailed: 'تعذّر بدء التفريغ. حاول مرة أخرى.',
    cancelFailed: 'تعذّر إلغاء التفريغ. حاول مرة أخرى.',
  },
  editor: {
    title: 'تعديل ترجمة {language}',
    banner: 'لا يرى المشاهدون هذه المسودة حتى تنشرها.',
    saved: 'تم الحفظ',
    saving: 'جارٍ الحفظ…',
    unsaved: 'تغييرات غير محفوظة',
    saveFailed: 'تعذّر حفظ تغييراتك.',
    retry: 'حاول مرة أخرى',
    close: 'إغلاق',
    undo: 'تراجع',
    redo: 'إعادة',
    find: 'بحث',
    replaceWith: 'استبدال بـ',
    replaceAll: 'استبدال الكل',
    replaced: 'تم استبدال {count}',
    confirmAll: 'تأكيد كل الاقتراحات ({count})',
    mergeNext: 'دمج مع التالي',
    split: 'تقسيم عند المؤشر',
    deleteCue: 'حذف السطر',
    start: 'البداية',
    end: 'النهاية',
    startEarlier: 'البدء قبل ٠٫١ ث',
    startLater: 'البدء بعد ٠٫١ ث',
    endEarlier: 'الانتهاء قبل ٠٫١ ث',
    endLater: 'الانتهاء بعد ٠٫١ ث',
    playFrom: 'تشغيل من {time}',
    cueText: 'نص السطر',
    cueList: 'أسطر الترجمة',
    empty: 'لا تحتوي هذه المسودة على أسطر.',
    publishSaved: 'نشر',
  },
  quran: {
    label: 'قرآن',
    suggested: 'مقترح',
    possible: 'قد يكون قرآنًا',
    confirmed: 'مؤكَّد',
    basmala: 'البسملة',
    accept: 'تأكيد',
    notQuran: 'ليس قرآنًا',
    changeRef: 'موضع آخر',
    applyRef: 'استخدام هذا الموضع',
    cancel: 'إلغاء',
    refLabel: 'السورة والآية',
    refPlaceholder: 'مثل ٣:١٦٦ أو ٣:١٦٦-١٦٧',
    refInvalid: 'أدخل رقم السورة والآية، مثل ٣:١٦٦ أو ٣:١٦٦-١٦٧.',
    refChecking: 'جارٍ التحقق…',
    appearsIn: 'وردت هذه الكلمات أيضًا في {list}',
    checkOnQuranCom: 'التحقق على quran.com',
    officialText: 'النص الرسمي',
    unconfirmedHint: 'حتى تؤكده، يرى المشاهدون الموضع مع رابط quran.com دون النص.',
    textUnavailable: 'النص الرسمي غير متاح الآن، ويرى المشاهدون الموضع.',
    attribution: 'نص القرآن: مؤسسة القرآن (quran.com)',
  },
};
