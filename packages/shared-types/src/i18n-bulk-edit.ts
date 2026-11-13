/**
 * Bulk rename and bulk edit (Epic 5.3), en/ar: Studio's "Edit selected"
 * panel and the upload queue's "Set for all / set for selected files". Shared
 * by the web static fallback and the api-videos translation seed, like
 * i18n-library.ts.
 */

export interface BulkRenameTranslations {
  section: string;
  modeLabel: string;
  modePattern: string;
  modeReplace: string;
  modeAffix: string;
  modeCase: string;
  pattern: string;
  patternHint: string;
  insertToken: string;
  tokenN: string;
  tokenFilename: string;
  tokenTitle: string;
  tokenDate: string;
  tokenChannel: string;
  start: string;
  step: string;
  pad: string;
  find: string;
  replaceWith: string;
  ignoreCase: string;
  prefix: string;
  suffix: string;
  caseMode: string;
  caseUpper: string;
  caseLower: string;
  caseTitle: string;
  caseSentence: string;
  languages: string;
  languagesHint: string;
  langEn: string;
  langAr: string;
  arabicDigits: string;
  digitsLatin: string;
  digitsArabic: string;
  preview: string;
  previewCaption: string;
  colInclude: string;
  colField: string;
  colBefore: string;
  colAfter: string;
  include: string;
  emptyValue: string;
  problemEmpty: string;
  problemTooLong: string;
  problemDuplicate: string;
  unchanged: string;
  excluded: string;
  skippedNoTitle: { en: string; ar: string };
  summary: string;
  showMore: string;
  /** Order of the rename (numbers follow it) */
  orderBy: string;
  orderKeys: { list: string; title: string; filename: string; uploaded: string; published: string; duration: string };
  ascending: string;
  descending: string;
  customOrder: string;
  orderHint: string;
  /** Under the direction button after a move by hand: sorting again drops it */
  orderReplacesManual: string;
  /** Some subjects have nothing to sort by ({count}, {field}) */
  orderMissing: string;
  /** A sort no subject has a value for ({field}); the option is disabled */
  orderKeyUnavailable: string;
  dragHandle: string;
  moveUp: string;
  moveDown: string;
  moved: string;
  position: string;
  continueFind: string;
  continueLoading: string;
  continueFound: string;
  continueUse: string;
  continueNone: string;
}

export interface BulkFieldTranslations {
  title: string;
  description: string;
  descriptionEn: string;
  descriptionAr: string;
  descriptionMode: string;
  append: string;
  prepend: string;
  replace: string;
  category: string;
  categoryPlaceholder: string;
  language: string;
  languageNames: { en: string; ar: string; ur: string; fr: string };
  visibility: string;
  public: string;
  private: string;
  playlists: string;
  addToPlaylists: string;
  removeFromPlaylists: string;
  alsoOrderPlaylist: string;
  alsoOrderPlaylistHint: string;
  tags: string;
  tagsMode: string;
  tagsAdd: string;
  tagsRemove: string;
  tagsReplace: string;
  schedule: string;
  scheduleStart: string;
  scheduleEvery: string;
  scheduleEveryHint: string;
  hours: string;
  days: string;
  comments: string;
  commentsOn: string;
  commentsHeld: string;
  commentsOff: string;
}

export interface BulkEditTranslations {
  button: string;
  title: string;
  description: string;
  visibility: string;
  category: string;
  noChange: string;
  public: string;
  private: string;
  clearCategory: string;
  addTags: string;
  removeTags: string;
  tagsHint: string;
  apply: string;
  applying: string;
  cancel: string;
  nothingToApply: string;
  done: string;
  partial: string;
  failed: string;

  /** Studio "Edit selected" panel */
  panelTitle: string;
  panelIntro: string;
  changeField: string;
  untouched: string;
  willChange: string;
  /** Upload queue: a ticked field / an unticked one */
  willSet: string;
  leftToFiles: string;
  /** A ticked field with nothing chosen yet */
  fieldIncomplete: string;
  close: string;
  review: string;
  confirmTitle: string;
  confirmBody: string;
  confirmApply: string;
  back: string;
  progress: string;
  cancelRun: string;
  cancelled: string;
  resultTitle: string;
  failedList: string;
  retryFailed: string;
  undo: string;
  undoHint: string;
  undoing: string;
  undone: string;
  undoPartial: string;
  playlistOrdered: string;
  playlistOrderSkipped: string;
  reasons: Record<string, string>;

  /** Selection in Studio */
  selectAllShown: string;
  selectAllMatching: string;
  clearSelection: string;
  selectedCount: string;
  loadingMatching: string;
  otherActionsLimit: string;

  /** Upload queue: setting values, not editing */
  setValues: string;
  setValuesTitle: string;
  setValuesIntro: string;
  scopeLabel: string;
  scopeAll: string;
  scopeSelected: string;
  setField: string;
  overwrite: string;
  overwriteHint: string;
  applySet: string;
  setDone: string;
  setSkipped: string;
  selectFile: string;
  selectAllFiles: string;
  rowTitleEn: string;
  rowTitleAr: string;
  rowEdited: string;
  rowSaving: string;
  rowSaved: string;
  rowSaveFailed: string;

  /** English/Arabic pairs */
  translateFromEnglish: string;
  translateFromArabic: string;
  numberingShared: string;
  numberingSharedHint: string;

  rename: BulkRenameTranslations;
  fields: BulkFieldTranslations;
}

const RENAME_EN: BulkRenameTranslations = {
  section: 'Titles',
  modeLabel: 'How to rename',
  modePattern: 'Pattern',
  modeReplace: 'Find and replace',
  modeAffix: 'Add prefix or suffix',
  modeCase: 'Change case',
  pattern: 'Pattern',
  patternHint: 'Use the buttons to insert a token. Anything else is kept as you type it.',
  insertToken: 'Insert {token}',
  tokenN: 'Number',
  tokenFilename: 'File name',
  tokenTitle: 'Current title',
  tokenDate: 'Date',
  tokenChannel: 'Channel',
  start: 'Start at',
  step: 'Step',
  pad: 'Digits',
  find: 'Find',
  replaceWith: 'Replace with',
  ignoreCase: 'Ignore case',
  prefix: 'Prefix',
  suffix: 'Suffix',
  caseMode: 'Case',
  caseUpper: 'UPPERCASE',
  caseLower: 'lowercase',
  caseTitle: 'Title Case',
  caseSentence: 'Sentence case',
  languages: 'Title fields to change',
  languagesHint: 'Each language is changed on its own; English and Arabic are never mixed.',
  langEn: 'English title',
  langAr: 'Arabic title',
  arabicDigits: 'Numbers in Arabic titles',
  digitsLatin: 'Latin (1, 2, 3)',
  digitsArabic: 'Arabic-Indic (١، ٢، ٣)',
  preview: 'Preview',
  previewCaption: 'Current and new titles. Untick a row to leave it out.',
  colInclude: 'Include',
  colField: 'Field',
  colBefore: 'Current',
  colAfter: 'New',
  include: 'Include “{title}”',
  emptyValue: '(empty)',
  problemEmpty: 'Empty',
  problemTooLong: 'Over {max} characters',
  problemDuplicate: 'Duplicate',
  unchanged: 'No change',
  excluded: 'Left out',
  skippedNoTitle: { en: 'Skipped: no English title', ar: 'Skipped: no Arabic title' },
  summary: '{applies} will change, {skipped} skipped, {blocked} blocked, {duplicates} duplicates, {unchanged} unchanged',
  showMore: 'Show all {count} rows',
  orderBy: 'Order',
  orderKeys: { list: 'As listed', title: 'Current title', filename: 'File name', uploaded: 'Upload date', published: 'Publish date', duration: 'Duration' },
  ascending: 'Ascending',
  descending: 'Descending',
  customOrder: 'Your own order',
  orderReplacesManual: 'You moved rows by hand. Choosing a sort or a direction sorts again and replaces that order.',
  orderMissing: '{count} have no “{field}” and stay at the end.',
  orderKeyUnavailable: '{field} (none to sort by)',
  orderHint: 'Numbers follow this order. Drag a row, use its arrows, or press Alt+↑ / Alt+↓.',
  dragHandle: 'Drag to reorder “{title}”',
  moveUp: 'Move “{title}” up',
  moveDown: 'Move “{title}” down',
  moved: 'Moved to position {position} of {total}',
  position: '{position}.',
  continueFind: 'Continue numbering after…',
  continueLoading: 'Looking through the channel’s titles…',
  continueFound: 'Highest existing number for this pattern: {n}',
  continueUse: 'Start at {next}',
  continueNone: 'No existing title matches this pattern.',
};

const RENAME_AR: BulkRenameTranslations = {
  section: 'العناوين',
  modeLabel: 'طريقة إعادة التسمية',
  modePattern: 'نمط',
  modeReplace: 'بحث واستبدال',
  modeAffix: 'إضافة بادئة أو لاحقة',
  modeCase: 'تغيير حالة الأحرف',
  pattern: 'النمط',
  patternHint: 'استخدم الأزرار لإدراج رمز. يبقى أي نص آخر كما تكتبه.',
  insertToken: 'إدراج {token}',
  tokenN: 'رقم',
  tokenFilename: 'اسم الملف',
  tokenTitle: 'العنوان الحالي',
  tokenDate: 'التاريخ',
  tokenChannel: 'القناة',
  start: 'يبدأ من',
  step: 'الزيادة',
  pad: 'عدد الخانات',
  find: 'ابحث عن',
  replaceWith: 'استبدل بـ',
  ignoreCase: 'تجاهل حالة الأحرف',
  prefix: 'بادئة',
  suffix: 'لاحقة',
  caseMode: 'حالة الأحرف',
  caseUpper: 'أحرف كبيرة',
  caseLower: 'أحرف صغيرة',
  caseTitle: 'أول كل كلمة كبير',
  caseSentence: 'أول الجملة كبير',
  languages: 'حقول العناوين التي تتغير',
  languagesHint: 'تتغير كل لغة وحدها، ولا يُخلط العنوان العربي بالإنجليزي أبدًا.',
  langEn: 'العنوان الإنجليزي',
  langAr: 'العنوان العربي',
  arabicDigits: 'الأرقام في العناوين العربية',
  digitsLatin: 'لاتينية (1، 2، 3)',
  digitsArabic: 'هندية (١، ٢، ٣)',
  preview: 'معاينة',
  previewCaption: 'العناوين الحالية والجديدة. ألغِ تحديد صف لاستبعاده.',
  colInclude: 'تضمين',
  colField: 'الحقل',
  colBefore: 'الحالي',
  colAfter: 'الجديد',
  include: 'تضمين «{title}»',
  emptyValue: '(فارغ)',
  problemEmpty: 'فارغ',
  problemTooLong: 'أطول من {max} حرفًا',
  problemDuplicate: 'مكرر',
  unchanged: 'بدون تغيير',
  excluded: 'مستبعد',
  skippedNoTitle: { en: 'تُرك: لا يوجد عنوان إنجليزي', ar: 'تُرك: لا يوجد عنوان عربي' },
  summary: 'سيتغير {applies}، ومتروك {skipped}، ومحظور {blocked}، ومكرر {duplicates}، وبدون تغيير {unchanged}',
  showMore: 'عرض كل الصفوف ({count})',
  orderBy: 'الترتيب',
  orderKeys: { list: 'كما في القائمة', title: 'العنوان الحالي', filename: 'اسم الملف', uploaded: 'تاريخ الرفع', published: 'تاريخ النشر', duration: 'المدة' },
  ascending: 'تصاعدي',
  descending: 'تنازلي',
  customOrder: 'ترتيبك الخاص',
  orderReplacesManual: 'نقلت صفوفًا بيدك. اختيار ترتيب أو اتجاه يعيد الترتيب ويستبدل ترتيبك.',
  orderMissing: '{count} بلا «{field}» وتبقى في الآخر.',
  orderKeyUnavailable: '{field} (لا شيء للترتيب به)',
  orderHint: 'تتبع الأرقام هذا الترتيب. اسحب صفًا، أو استخدم أسهمه، أو اضغط Alt+↑ / Alt+↓.',
  dragHandle: 'اسحب لإعادة ترتيب «{title}»',
  moveUp: 'نقل «{title}» إلى أعلى',
  moveDown: 'نقل «{title}» إلى أسفل',
  moved: 'نُقل إلى الموضع {position} من {total}',
  position: '{position}',
  continueFind: 'متابعة الترقيم بعد…',
  continueLoading: 'جارٍ البحث في عناوين القناة…',
  continueFound: 'أعلى رقم موجود لهذا النمط: {n}',
  continueUse: 'ابدأ من {next}',
  continueNone: 'لا يوجد عنوان يطابق هذا النمط.',
};

const FIELDS_EN: BulkFieldTranslations = {
  title: 'Titles',
  description: 'Description',
  descriptionEn: 'English description',
  descriptionAr: 'Arabic description',
  descriptionMode: 'How',
  append: 'Add at the end',
  prepend: 'Add at the start',
  replace: 'Replace',
  category: 'Category',
  categoryPlaceholder: 'Type to find a category',
  language: 'Language',
  languageNames: { en: 'English', ar: 'Arabic', ur: 'Urdu', fr: 'French' },
  visibility: 'Visibility',
  public: 'Public',
  private: 'Private',
  playlists: 'Playlists',
  addToPlaylists: 'Add to playlists',
  removeFromPlaylists: 'Remove from playlists',
  alsoOrderPlaylist: 'Also order in playlist',
  alsoOrderPlaylistHint: 'The videos are placed together in the playlist, in the order above.',
  tags: 'Tags',
  tagsMode: 'How',
  tagsAdd: 'Add',
  tagsRemove: 'Remove',
  tagsReplace: 'Replace all',
  schedule: 'Publish time',
  scheduleStart: 'First video publishes at',
  scheduleEvery: 'Then one every',
  scheduleEveryHint: '0 publishes them all at the same time.',
  hours: 'hours',
  days: 'days',
  comments: 'Comments',
  commentsOn: 'On',
  commentsHeld: 'Held for review',
  commentsOff: 'Off',
};

const FIELDS_AR: BulkFieldTranslations = {
  title: 'العناوين',
  description: 'الوصف',
  descriptionEn: 'الوصف الإنجليزي',
  descriptionAr: 'الوصف العربي',
  descriptionMode: 'الطريقة',
  append: 'إضافة في النهاية',
  prepend: 'إضافة في البداية',
  replace: 'استبدال',
  category: 'التصنيف',
  categoryPlaceholder: 'اكتب للبحث عن تصنيف',
  language: 'اللغة',
  languageNames: { en: 'الإنجليزية', ar: 'العربية', ur: 'الأردية', fr: 'الفرنسية' },
  visibility: 'الظهور',
  public: 'عام',
  private: 'خاص',
  playlists: 'قوائم التشغيل',
  addToPlaylists: 'إضافة إلى قوائم التشغيل',
  removeFromPlaylists: 'إزالة من قوائم التشغيل',
  alsoOrderPlaylist: 'رتّبها في قائمة التشغيل أيضًا',
  alsoOrderPlaylistHint: 'توضع المرئيات متجاورة في قائمة التشغيل بالترتيب الظاهر أعلاه.',
  tags: 'الوسوم',
  tagsMode: 'الطريقة',
  tagsAdd: 'إضافة',
  tagsRemove: 'إزالة',
  tagsReplace: 'استبدال الكل',
  schedule: 'وقت النشر',
  scheduleStart: 'يُنشر أول مرئي في',
  scheduleEvery: 'ثم مرئي كل',
  scheduleEveryHint: 'القيمة 0 تنشرها كلها في الوقت نفسه.',
  hours: 'ساعات',
  days: 'أيام',
  comments: 'التعليقات',
  commentsOn: 'مفعّلة',
  commentsHeld: 'تُراجع قبل النشر',
  commentsOff: 'معطّلة',
};

export const BULK_EDIT_EN: BulkEditTranslations = {
  button: 'Edit',
  title: 'Edit {count} videos',
  description: 'Only the fields you change are updated. Scheduled videos keep the visibility set by their schedule.',
  visibility: 'Visibility',
  category: 'Category',
  noChange: 'No change',
  public: 'Public',
  private: 'Private',
  clearCategory: 'Remove category',
  addTags: 'Add tags',
  removeTags: 'Remove tags',
  tagsHint: 'Separate tags with commas',
  apply: 'Apply changes',
  applying: 'Applying…',
  cancel: 'Cancel',
  nothingToApply: 'Choose at least one change.',
  done: '{count} videos updated',
  partial: '{succeeded} updated, {failed} failed',
  failed: 'The videos could not be updated. Please try again.',

  panelTitle: 'Edit {count} videos',
  panelIntro: 'Tick the fields to change. Everything else stays as it is.',
  changeField: 'Change {field}',
  untouched: 'Stays as it is',
  willChange: 'Will change',
  willSet: 'Will be set',
  leftToFiles: 'Each file keeps its own',
  fieldIncomplete: 'Fill this in, or untick it.',
  close: 'Close',
  review: 'Review changes',
  confirmTitle: 'Apply to {count} videos?',
  confirmBody: 'These fields change: {fields}. You can undo this for 24 hours.',
  confirmApply: 'Apply',
  back: 'Back',
  progress: 'Updating {done} of {total}…',
  cancelRun: 'Stop',
  cancelled: 'Stopped. {done} of {total} were updated before you stopped.',
  resultTitle: 'Result',
  failedList: 'Not updated',
  retryFailed: 'Retry the {count} that failed',
  undo: 'Undo',
  undoHint: 'You can undo this edit for 24 hours.',
  undoing: 'Undoing…',
  undone: 'Undone. {count} videos are back as they were.',
  undoPartial: 'Undone for {restored}. {kept} kept newer changes made since.',
  playlistOrdered: 'Ordered in the playlist too.',
  playlistOrderSkipped: 'The playlist sorts itself automatically, so its order was left as it is.',
  reasons: {
    not_found: 'Video not found',
    forbidden: 'You can’t edit this video',
    scheduled: 'Visibility follows its schedule',
    too_many_tags: 'Too many tags',
    title_empty: 'Title would be empty',
    title_too_long: 'Title would be too long',
    description_too_long: 'Description would be too long',
    playlist_other_channel: 'Playlist is on another channel',
    playlist_full: 'Playlist is full',
    schedule_invalid: 'Publish time isn’t possible',
    already_published: 'Already published',
    failed: 'Something went wrong',
  },

  selectAllShown: 'Select all shown ({count})',
  selectAllMatching: 'Select all {count} matching',
  clearSelection: 'Clear selection',
  selectedCount: '{count} selected',
  loadingMatching: 'Selecting all matching videos…',
  otherActionsLimit: 'Add to playlist, Schedule and Delete take up to {max} at a time; Edit takes them all.',

  setValues: 'Set values',
  setValuesTitle: 'Set values for files',
  setValuesIntro: 'Choose the fields to set. Each file’s own changes are kept unless you choose to overwrite them.',
  scopeLabel: 'Set for',
  scopeAll: 'All files ({count})',
  scopeSelected: 'Selected files ({count})',
  setField: 'Set {field}',
  overwrite: 'Overwrite my changes',
  overwriteHint: 'Also replace values you typed on a file yourself.',
  applySet: 'Set values',
  setDone: 'Values set for {count} files.',
  setSkipped: '{count} values you changed by hand were kept.',
  selectFile: 'Select {name}',
  selectAllFiles: 'Select all files',
  rowTitleEn: 'English title',
  rowTitleAr: 'Arabic title',
  rowEdited: 'Changed by you',
  rowSaving: 'Saving…',
  rowSaved: 'Saved',
  rowSaveFailed: 'Not saved, will retry',

  translateFromEnglish: 'Translate from English',
  translateFromArabic: 'Translate from Arabic',
  numberingShared: 'Numbering (both languages)',
  numberingSharedHint: 'A video gets the same {n} in English and Arabic.',

  rename: RENAME_EN,
  fields: FIELDS_EN,
};

export const BULK_EDIT_AR: BulkEditTranslations = {
  button: 'تعديل',
  title: 'تعديل {count} من المرئيات',
  description: 'تُحدَّث الحقول التي تغيّرها فقط. تحتفظ المرئيات المجدولة بالظهور الذي يحدده جدولها.',
  visibility: 'الظهور',
  category: 'التصنيف',
  noChange: 'بدون تغيير',
  public: 'عام',
  private: 'خاص',
  clearCategory: 'إزالة التصنيف',
  addTags: 'إضافة وسوم',
  removeTags: 'إزالة وسوم',
  tagsHint: 'افصل بين الوسوم بفواصل',
  apply: 'تطبيق التغييرات',
  applying: 'جارٍ التطبيق…',
  cancel: 'إلغاء',
  nothingToApply: 'اختر تغييرًا واحدًا على الأقل.',
  done: 'تم تحديث {count} من المرئيات',
  partial: 'تم تحديث {succeeded}، وتعذّر {failed}',
  failed: 'تعذّر تحديث المرئيات. حاول مرة أخرى.',

  panelTitle: 'تعديل {count} من المرئيات',
  panelIntro: 'حدّد الحقول التي تريد تغييرها. يبقى كل ما عداها كما هو.',
  changeField: 'تغيير {field}',
  untouched: 'يبقى كما هو',
  willChange: 'سيتغير',
  willSet: 'سيُعيَّن',
  leftToFiles: 'يحتفظ كل ملف بقيمته',
  fieldIncomplete: 'أكمل هذا الحقل أو ألغِ تحديده.',
  close: 'إغلاق',
  review: 'مراجعة التغييرات',
  confirmTitle: 'تطبيق على {count} من المرئيات؟',
  confirmBody: 'تتغير هذه الحقول: {fields}. يمكنك التراجع خلال 24 ساعة.',
  confirmApply: 'تطبيق',
  back: 'رجوع',
  progress: 'جارٍ تحديث {done} من {total}…',
  cancelRun: 'إيقاف',
  cancelled: 'تم الإيقاف. حُدِّث {done} من {total} قبل الإيقاف.',
  resultTitle: 'النتيجة',
  failedList: 'لم تُحدَّث',
  retryFailed: 'إعادة محاولة {count} تعذّر تحديثها',
  undo: 'تراجع',
  undoHint: 'يمكنك التراجع عن هذا التعديل خلال 24 ساعة.',
  undoing: 'جارٍ التراجع…',
  undone: 'تم التراجع. عاد {count} من المرئيات كما كانت.',
  undoPartial: 'تم التراجع عن {restored}. واحتفظ {kept} بتغييرات أحدث أُجريت بعده.',
  playlistOrdered: 'رُتّبت في قائمة التشغيل أيضًا.',
  playlistOrderSkipped: 'قائمة التشغيل مرتبة تلقائيًا، فبقي ترتيبها كما هو.',
  reasons: {
    not_found: 'المرئي غير موجود',
    forbidden: 'لا يمكنك تعديل هذا المرئي',
    scheduled: 'ظهوره يتبع جدوله',
    too_many_tags: 'الوسوم أكثر من المسموح',
    title_empty: 'سيصبح العنوان فارغًا',
    title_too_long: 'سيصبح العنوان أطول من المسموح',
    description_too_long: 'سيصبح الوصف أطول من المسموح',
    playlist_other_channel: 'قائمة التشغيل في قناة أخرى',
    playlist_full: 'قائمة التشغيل ممتلئة',
    schedule_invalid: 'وقت النشر غير ممكن',
    already_published: 'منشور بالفعل',
    failed: 'حدث خطأ ما',
  },

  selectAllShown: 'تحديد كل المعروض ({count})',
  selectAllMatching: 'تحديد كل المطابق ({count})',
  clearSelection: 'إلغاء التحديد',
  selectedCount: 'تم تحديد {count}',
  loadingMatching: 'جارٍ تحديد كل المرئيات المطابقة…',
  otherActionsLimit: 'الإضافة إلى قائمة تشغيل والجدولة والحذف تقبل {max} كحد أقصى في المرة الواحدة؛ أما التعديل فيقبلها كلها.',

  setValues: 'تعيين القيم',
  setValuesTitle: 'تعيين قيم للملفات',
  setValuesIntro: 'اختر الحقول التي تريد تعيينها. تبقى تغييراتك على كل ملف ما لم تختر استبدالها.',
  scopeLabel: 'التعيين لـ',
  scopeAll: 'كل الملفات ({count})',
  scopeSelected: 'الملفات المحددة ({count})',
  setField: 'تعيين {field}',
  overwrite: 'استبدال تغييراتي',
  overwriteHint: 'استبدل أيضًا القيم التي كتبتها بنفسك على ملف.',
  applySet: 'تعيين القيم',
  setDone: 'عُيِّنت القيم لـ {count} من الملفات.',
  setSkipped: 'بقيت {count} من القيم التي غيّرتها بنفسك.',
  selectFile: 'تحديد {name}',
  selectAllFiles: 'تحديد كل الملفات',
  rowTitleEn: 'العنوان الإنجليزي',
  rowTitleAr: 'العنوان العربي',
  rowEdited: 'غيّرته بنفسك',
  rowSaving: 'جارٍ الحفظ…',
  rowSaved: 'تم الحفظ',
  rowSaveFailed: 'لم يُحفظ، ستُعاد المحاولة',

  translateFromEnglish: 'ترجمة من الإنجليزية',
  translateFromArabic: 'ترجمة من العربية',
  numberingShared: 'الترقيم (للغتين)',
  numberingSharedHint: 'يأخذ المرئي الرقم {n} نفسه بالإنجليزية والعربية.',

  rename: RENAME_AR,
  fields: FIELDS_AR,
};
