/**
 * Caption drafts in Studio (AUN-CAPTIONS §3.1, §3.3), en/ar. Shared by the web static fallback and
 * the api-videos translation seed, like i18n-upload-status.ts.
 * Placeholders: {count}, {language}, {time}, {list}.
 */

export interface CaptionsTranslations {
  draftsTitle: string;
  /** Drafts are private until published */
  draftsHint: string;
  origin: { review_transcript: string; transcription: string; translation: string; on_device: string };
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
  /** Saving a caption file in Studio (QF 2026-11-22: one video, one language per file) */
  download: {
    /** Same wording as the player's captions menu (#1735) */
    action: string;
    /** Above the formats, once the button opened them */
    choose: string;
    vtt: string;
    srt: string;
    failed: string;
  };
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
    /** {minutes} {remaining} {over}: the job costs more than is left */
    costOver: string;
    /** The video's length isn't known yet */
    notReady: string;
    /** {used} {limit} {date} */
    meter: string;
    meterUnlimited: string;
    /** Accessible name of the meter */
    meterLabel: string;
    /** {used} {limit} {over}: the balance is below 0 */
    meterOver: string;
    /** {count}: minutes charged to a job still running */
    meterHeld: string;
    /** {count} minutes left on extra grants */
    meterPacks: string;
    meterWarning: string;
    /** Balance 0 or below, with an overdraft: {over} {date} */
    outOver: string;
    /** Balance exactly 0: {date} */
    outUsed: string;
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
      /** {done} {total}: batches of a translation */
      translating: string;
      translatingStart: string;
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
    failed: {
      audio_unavailable: string;
      transcription_failed: string;
      no_speech: string;
      draft_exists: string;
      video_gone: string;
      source_missing: string;
      source_changed: string;
      translation_failed: string;
      failed: string;
    };
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
    /** Names the Arabic text the card shows */
    textEdition: string;
    /** On a translated draft: {name} is the Quran Foundation translation its viewers see there */
    translationEdition: string;
  };
  /** Translating a caption draft into other languages (§3.3, caption minutes) */
  translate: {
    action: string;
    title: string;
    /** {language}: the source draft */
    body: string;
    languagesLabel: string;
    /** {count}: the most languages one request may ask for */
    limit: string;
    /** {minutes} {remaining} */
    cost: string;
    /** {minutes} */
    costUnlimited: string;
    /** {minutes} {remaining} {over} */
    costOver: string;
    quranNote: string;
    confirm: string;
    cancel: string;
    /** {language} */
    replaceTitle: string;
    /** {language} */
    replaceBody: string;
    replace: string;
    started: string;
    requestFailed: string;
    notReady: string;
    noMinutes: string;
    /** {language}: on a translation draft */
    from: string;
    review: string;
    /** {language}: the source changed after the translation was made */
    sourceChanged: string;
    cancelTitle: string;
    cancelBody: string;
    cancelConfirm: string;
    keep: string;
  };
  /** The Translate button beside titles and descriptions (§3.4, O5) */
  inline: {
    working: string;
    hint: string;
    replaceTitle: string;
    /** {language} */
    replaceBody: string;
    replace: string;
    keep: string;
    /** {time} */
    fairUse: string;
    budget: string;
    failed: string;
    quranKept: string;
  };
  /** Viewers: the caption menu and translated titles (§3.5, §5.9) */
  viewer: {
    /** Appended to a translated track's name in the caption menu */
    machineTranslation: string;
    translatedTitle: string;
    showOriginal: string;
    showTranslation: string;
  };
  /** Channel settings: the Quran translation shown in translated tracks (O7) and viewer-title opt-out */
  channelSettings: {
    title: string;
    hint: string;
    quranTitle: string;
    quranHint: string;
    language: string;
    edition: string;
    sourceChannel: string;
    sourcePlatform: string;
    sourceDefault: string;
    save: string;
    reset: string;
    saved: string;
    failed: string;
    unavailable: string;
    addLanguage: string;
    viewerTitles: string;
    viewerTitlesHint: string;
  };
}

export const CAPTIONS_EN: CaptionsTranslations = {
  draftsTitle: 'Caption drafts',
  draftsHint: 'Only you and your channel team see a draft. Viewers see it once you publish it.',
  origin: {
    review_transcript: 'From the automatic transcript',
    transcription: 'Automatic transcription',
    on_device: 'Transcribed on your computer',
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
  publishFailed: "Couldn’t publish the draft. Try again.",
  deleteFailed: "Couldn’t delete the draft. Try again.",
  loadFailed: "Couldn’t load the caption drafts.",
  conflict: 'This draft was changed in another window. Reload it to continue.',
  reload: 'Reload',
  download: {
    action: 'Download captions',
    choose: 'Choose a file format',
    vtt: 'WebVTT (.vtt)',
    srt: 'SubRip (.srt)',
    failed: "Couldn’t download the captions. Try again.",
  },
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
      failed: "Couldn’t prepare the draft. Our team has been told.",
    },
    tryAgain: 'Try again',
    requestFailed: "Couldn’t start the draft. Try again.",
  },
  jobs: {
    title: 'Transcribe this video',
    body: 'Get captions from what is said in the video. You get a draft to check and publish, and Quran in it is shown as the official text once you confirm it.',
    languageLabel: 'Language spoken in the video',
    action: 'Transcribe',
    confirmTitle: 'Transcribe this video?',
    cost: 'This uses {minutes} of your {remaining} remaining caption minutes.',
    costUnlimited: 'This uses {minutes} caption minutes. Your plan has no monthly limit.',
    costOver: "This uses {minutes} minutes and you have {remaining} left. You’ll go {over} minutes over, and that comes off next month’s minutes.",
    notReady: 'You can transcribe the video once it has finished processing.',
    meter: 'Caption minutes: {used} / {limit} this month · resets {date}',
    meterUnlimited: 'Caption minutes: no monthly limit',
    meterLabel: 'Caption minutes used this month',
    meterOver: 'Caption minutes: {used} / {limit} this month · {over} over',
    meterHeld: 'Includes {count} minutes for the transcription in progress.',
    meterPacks: '+{count} extra minutes',
    meterWarning: "You’ve used most of this month’s caption minutes.",
    outOver: "You’re {over} minutes over this month’s caption minutes. You can transcribe again when your minutes reset on {date}, and the overdraft comes off them first.",
    outUsed: "You’ve used all of this month’s caption minutes. They reset on {date}.",
    replaceTitle: 'Replace your draft?',
    replaceBody: 'You already have a {language} draft. The new transcript replaces it and your edits.',
    step: {
      queued: 'Waiting to start',
      waiting_budget: 'Waiting',
      extracting: 'Preparing audio',
      transcribing: 'Transcribing {done}/{total}',
      transcribingStart: 'Transcribing',
      translating: 'Translating {done}/{total}',
      translatingStart: 'Translating',
      postprocessing: 'Checking Quran',
    },
    chip: '{language}: {step}',
    waitingBudgetHint: "Today’s transcription capacity is used up. It will start on its own tomorrow.",
    cancel: 'Cancel',
    cancelTitle: 'Cancel the transcription?',
    cancelBody: 'The caption minutes it holds come back to you.',
    cancelConfirm: 'Cancel transcription',
    keep: 'Keep transcribing',
    cancelled: 'Transcription cancelled. The minutes are back.',
    finishing: "It’s almost done: the draft is being written, so it can’t be cancelled now.",
    ready: 'The {language} draft is ready to check.',
    failed: {
      audio_unavailable: "We couldn’t get the audio of this video.",
      transcription_failed: "The transcription didn’t work.",
      no_speech: 'No speech was found in this video.',
      draft_exists: 'A draft in this language already exists.',
      video_gone: 'This video is no longer available.',
      source_missing: 'The draft to translate is gone.',
      source_changed: 'The draft changed while it was being translated. Translate it again.',
      translation_failed: "The translation didn’t work.",
      failed: "The transcription didn’t work. Our team has been told.",
    },
    refunded: 'Your {minutes} caption minutes were given back.',
    tryAgain: 'Try again',
    paused: 'Transcription is paused right now. Try again later.',
    requestFailed: "Couldn’t start the transcription. Try again.",
    cancelFailed: "Couldn’t cancel the transcription. Try again.",
  },
  editor: {
    title: 'Edit {language} captions',
    banner: "Viewers don’t see this draft until you publish it.",
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved changes',
    saveFailed: "Couldn’t save your changes.",
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
    startEarlier: 'Start {step} s earlier',
    startLater: 'Start {step} s later',
    endEarlier: 'End {step} s earlier',
    endLater: 'End {step} s later',
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
    textUnavailable: "The official text isn’t available right now. Viewers see the reference.",
    attribution: 'Quran data provided by Quran\u00a0Foundation\u00a0(https://quran.foundation/)',
    textEdition: 'Quran text: Uthmani (Hafs)',
    translationEdition: 'Translation shown to viewers: {name}',
  },
  translate: {
    action: 'Translate',
    title: 'Translate this transcript',
    body: 'Machine-translate your {language} draft into other languages. Each translation is a draft you check before publishing.',
    languagesLabel: 'Languages',
    limit: 'Up to {count} languages at a time.',
    cost: 'Uses {minutes} caption minutes. {remaining} left this month.',
    costUnlimited: 'Uses {minutes} caption minutes (no monthly limit).',
    costOver: 'Uses {minutes} caption minutes, {over} more than the {remaining} you have left. The extra comes off next month.',
    quranNote: 'Quran is never machine-translated: confirmed ayat show in the translation your channel picked, with its name.',
    confirm: 'Translate',
    cancel: 'Cancel',
    replaceTitle: 'Replace the {language} draft?',
    replaceBody: 'You already have a {language} draft. The translation replaces it and your edits.',
    replace: 'Replace',
    started: 'Translation started. The drafts appear here when they are ready.',
    requestFailed: "The translation couldn’t start. Try again.",
    notReady: "This video’s length isn’t known yet. Try again once it has finished processing.",
    noMinutes: "You don’t have enough caption minutes to translate.",
    from: 'Machine translation from {language}',
    review: 'Machine translation: check it before publishing.',
    sourceChanged: 'The {language} draft changed after this translation was made.',
    cancelTitle: 'Cancel the translation?',
    cancelBody: 'The caption minutes it holds come back to you.',
    cancelConfirm: 'Cancel translation',
    keep: 'Keep translating',
  },
  inline: {
    working: 'Translating…',
    hint: 'Machine translation: review it before saving.',
    replaceTitle: 'Replace your text?',
    replaceBody: 'The {language} field already has text. Replace it with the translation?',
    replace: 'Replace',
    keep: 'Keep mine',
    fairUse: "You’ve used today’s translations. More at {time}.",
    budget: 'Translations are used up for today. Try again tomorrow.',
    failed: "Couldn’t translate. Try again.",
    quranKept: 'Quran in {…} was kept as written.',
  },
  viewer: {
    machineTranslation: 'machine translation',
    translatedTitle: 'Auto-translated',
    showOriginal: 'Show original',
    showTranslation: 'Show translation',
  },
  channelSettings: {
    title: 'Translation',
    hint: 'How translations of your videos appear to viewers.',
    quranTitle: 'Quran translation',
    quranHint: 'In machine-translated caption tracks, confirmed ayat show this Quran Foundation translation with its name. Arabic tracks show the Arabic text.',
    language: 'Language',
    edition: 'Translation',
    sourceChannel: 'Your choice',
    sourcePlatform: 'Site default',
    sourceDefault: 'Default',
    save: 'Save',
    reset: 'Use the default',
    saved: 'Saved.',
    failed: "Couldn’t save. Try again.",
    unavailable: "Quran translations can’t be loaded right now. Try again later.",
    addLanguage: 'Add a language',
    viewerTitles: 'Let viewers see machine-translated titles',
    viewerTitlesHint: "When a video has no title in a viewer’s language, they may see a labelled machine translation with “Show original”.",
  },
};

export const CAPTIONS_AR: CaptionsTranslations = {
  draftsTitle: 'مسودات الترجمة',
  draftsHint: 'لا يرى المسودة إلا أنت وفريق قناتك، ويراها المشاهدون بعد نشرها.',
  origin: {
    review_transcript: 'من النص التلقائي',
    transcription: 'تفريغ تلقائي',
    on_device: 'فُرِّغ على حاسوبك',
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
  download: {
    action: 'تنزيل الترجمة',
    choose: 'اختر صيغة الملف',
    vtt: 'WebVTT (.vtt)',
    srt: 'SubRip (.srt)',
    failed: 'تعذّر تنزيل الترجمة. حاول مرة أخرى.',
  },
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
    cost: 'يستهلك هذا {minutes} من دقائق التفريغ، ويبقى لك {remaining} منها.',
    costUnlimited: 'يستهلك هذا {minutes} من دقائق التفريغ. ليس لخطتك حد شهري.',
    costOver: 'يستهلك هذا {minutes} من الدقائق ويبقى لك {remaining} منها، فتتجاوز رصيدك بـ {over} من الدقائق تُخصم من دقائق الشهر القادم.',
    notReady: 'يمكنك تفريغ المرئي بعد انتهاء معالجته.',
    meter: 'دقائق التفريغ: {used} من {limit} هذا الشهر، تتجدد في {date}',
    meterUnlimited: 'دقائق التفريغ: بلا حد شهري',
    meterLabel: 'دقائق التفريغ المستهلكة هذا الشهر',
    meterOver: 'دقائق التفريغ: {used} من {limit} هذا الشهر، تجاوز بـ {over}',
    meterHeld: 'يشمل {count} من الدقائق للتفريغ الجاري.',
    meterPacks: '+{count} من الدقائق الإضافية',
    meterWarning: 'استهلكت معظم دقائق التفريغ لهذا الشهر.',
    outOver: 'تجاوزت دقائق التفريغ لهذا الشهر بـ {over} من الدقائق. يمكنك التفريغ مجددًا حين تتجدد دقائقك في {date}، ويُخصم التجاوز منها أولًا.',
    outUsed: 'استهلكت كل دقائق التفريغ لهذا الشهر. تتجدد في {date}.',
    replaceTitle: 'استبدال مسودتك؟',
    replaceBody: 'لديك مسودة {language} بالفعل. التفريغ الجديد يستبدلها مع تعديلاتك.',
    step: {
      queued: 'في انتظار البدء',
      waiting_budget: 'في الانتظار',
      extracting: 'جارٍ تجهيز الصوت',
      transcribing: 'جارٍ التفريغ {done}/{total}',
      transcribingStart: 'جارٍ التفريغ',
      translating: 'جارٍ الترجمة {done}/{total}',
      translatingStart: 'جارٍ الترجمة',
      postprocessing: 'جارٍ التحقق من القرآن',
    },
    chip: '{language}: {step}',
    waitingBudgetHint: 'استُنفدت طاقة التفريغ لهذا اليوم. سيبدأ تلقائيًا غدًا.',
    cancel: 'إلغاء',
    cancelTitle: 'إلغاء التفريغ؟',
    cancelBody: 'تعود إليك دقائق التفريغ المحجوزة له.',
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
      source_missing: 'المسودة المراد ترجمتها لم تعد موجودة.',
      source_changed: 'تغيّرت المسودة أثناء ترجمتها. ترجمها مرة أخرى.',
      translation_failed: 'لم تنجح الترجمة.',
      failed: 'لم ينجح التفريغ، وأُبلغ فريقنا.',
    },
    refunded: 'أُعيدت إليك {minutes} من دقائق التفريغ.',
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
    startEarlier: 'البدء قبل {step} ث',
    startLater: 'البدء بعد {step} ث',
    endEarlier: 'الانتهاء قبل {step} ث',
    endLater: 'الانتهاء بعد {step} ث',
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
    attribution: 'بيانات القرآن مقدَّمة من مؤسسة\u00a0القرآن\u00a0(https://quran.foundation/\u200e)',
    textEdition: 'نص القرآن: الرسم العثماني (حفص)',
    translationEdition: 'الترجمة المعروضة للمشاهدين: {name}',
  },
  translate: {
    action: 'ترجمة',
    title: 'ترجمة هذا النص',
    body: 'ترجم مسودة {language} آليًا إلى لغات أخرى. كل ترجمة مسودة تراجعها قبل النشر.',
    languagesLabel: 'اللغات',
    limit: 'حتى {count} لغات في المرة الواحدة.',
    cost: 'تستهلك {minutes} من دقائق التفريغ. يتبقى {remaining} هذا الشهر.',
    costUnlimited: 'تستهلك {minutes} من دقائق التفريغ (بلا حد شهري).',
    costOver: 'تستهلك {minutes} من دقائق التفريغ، أي {over} أكثر من {remaining} المتبقية لك. يُخصم الفرق من الشهر القادم.',
    quranNote: 'لا يُترجَم القرآن آليًا أبدًا: تظهر الآيات المؤكدة بالترجمة التي اختارتها قناتك مع اسمها.',
    confirm: 'ترجمة',
    cancel: 'إلغاء',
    replaceTitle: 'استبدال مسودة {language}؟',
    replaceBody: 'لديك مسودة {language} بالفعل. الترجمة تستبدلها مع تعديلاتك.',
    replace: 'استبدال',
    started: 'بدأت الترجمة. تظهر المسودات هنا عند جهوزيتها.',
    requestFailed: 'تعذّر بدء الترجمة. حاول مرة أخرى.',
    notReady: 'مدة هذا المرئي غير معروفة بعد. حاول مجددًا بعد انتهاء معالجته.',
    noMinutes: 'ليست لديك دقائق ترجمة كافية للترجمة.',
    from: 'ترجمة آلية من {language}',
    review: 'ترجمة آلية: راجعها قبل النشر.',
    sourceChanged: 'تغيّرت مسودة {language} بعد إعداد هذه الترجمة.',
    cancelTitle: 'إلغاء الترجمة؟',
    cancelBody: 'تعود إليك دقائق التفريغ المحجوزة لها.',
    cancelConfirm: 'إلغاء الترجمة',
    keep: 'متابعة الترجمة',
  },
  inline: {
    working: 'جارٍ الترجمة…',
    hint: 'ترجمة آلية: راجعها قبل الحفظ.',
    replaceTitle: 'استبدال نصك؟',
    replaceBody: 'في حقل {language} نص بالفعل. هل تستبدله بالترجمة؟',
    replace: 'استبدال',
    keep: 'الإبقاء على نصي',
    fairUse: 'استنفدت ترجمات اليوم. تتجدد في {time}.',
    budget: 'نفدت الترجمات لهذا اليوم. حاول غدًا.',
    failed: 'تعذّرت الترجمة. حاول مرة أخرى.',
    quranKept: 'بقي القرآن بين {…} كما كُتب.',
  },
  viewer: {
    machineTranslation: 'ترجمة آلية',
    translatedTitle: 'مترجم آليًا',
    showOriginal: 'عرض الأصل',
    showTranslation: 'عرض الترجمة',
  },
  channelSettings: {
    title: 'الترجمة',
    hint: 'كيف تظهر ترجمات مرئياتك للمشاهدين.',
    quranTitle: 'ترجمة القرآن',
    quranHint: 'في مسارات الترجمة الآلية، تظهر الآيات المؤكدة بترجمة Quran Foundation هذه مع اسمها. المسارات العربية تعرض النص العربي.',
    language: 'اللغة',
    edition: 'الترجمة',
    sourceChannel: 'اختيارك',
    sourcePlatform: 'الافتراضي للموقع',
    sourceDefault: 'الافتراضية',
    save: 'حفظ',
    reset: 'استخدام الافتراضية',
    saved: 'تم الحفظ.',
    failed: 'تعذّر الحفظ. حاول مرة أخرى.',
    unavailable: 'تعذّر تحميل ترجمات القرآن الآن. حاول لاحقًا.',
    addLanguage: 'إضافة لغة',
    viewerTitles: 'السماح للمشاهدين برؤية عناوين مترجمة آليًا',
    viewerTitlesHint: 'إن لم يكن للمرئي عنوان بلغة المشاهد، فقد يرى ترجمة آلية موسومة مع «عرض الأصل».',
  },
};
