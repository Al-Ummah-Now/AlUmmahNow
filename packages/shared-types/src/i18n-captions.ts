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
