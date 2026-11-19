/**
 * Studio's Audio tracks panel (wiki AUN-MULTI-AUDIO §Studio), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-captions.ts.
 * Placeholders: {used}, {allowed}, {percent}, {label}, {n}, {details}.
 */
import type { AudioTrackKind, AudioTrackState } from './audio-tracks';

export interface AudioTracksTranslations {
  title: string;
  hint: string;
  /** {used} of {allowed} */
  used: string;
  /** {used}: unlimited tiers */
  usedUnlimited: string;
  add: string;
  /** The tier allows no extra tracks */
  notIncluded: string;
  /** {allowed}: the tier's limit is reached */
  limitReached: string;
  notReady: string;
  /** No extra tracks yet */
  empty: string;
  /** 409 duplicate_track */
  duplicate: string;
  kinds: Record<AudioTrackKind, string>;
  states: Record<Exclude<AudioTrackState, 'uploading'>, string>;
  /** {percent} */
  uploading: string;
  /** The upload stopped part way (page closed): pick the file again to continue */
  resume: string;
  failedReasons: { processing_failed: string; unreadable_file: string; other: string };
  isDefault: string;
  makeDefault: string;
  edit: string;
  delete: string;
  retry: string;
  save: string;
  cancel: string;
  /** Package being rebuilt after a change */
  updating: string;
  form: {
    addTitle: string;
    editTitle: string;
    source: string;
    sourceUpload: string;
    sourceStream: string;
    file: string;
    fileHint: string;
    fileTooBig: string;
    fileType: string;
    /** No stream picked yet */
    pickStream: string;
    /** {n} the stream's number, {details} language/title/channels */
    stream: string;
    look: string;
    looking: string;
    noneFound: string;
    language: string;
    label: string;
    labelHint: string;
    kind: string;
    makeDefault: string;
    /** The first extra track also sets the language of the video's own audio */
    originalLanguage: string;
    submit: string;
  };
  deleteTitle: string;
  /** {label} */
  deleteBody: string;
  loadFailed: string;
  saveFailed: string;
  uploadFailed: string;
  deleteFailed: string;
  retryFailed: string;
  lookFailed: string;
  added: string;
  saved: string;
  deleted: string;
}

export const AUDIO_TRACKS_EN: AudioTracksTranslations = {
  title: 'Audio tracks',
  hint: 'Add dubs, commentary or audio description. Viewers pick a track in the player settings.',
  used: '{used} of {allowedTracks} used',
  usedUnlimited: '{used} audio tracks added',
  add: 'Add audio track',
  notIncluded: 'Your creator tier does not include extra audio tracks.',
  limitReached: 'Your creator tier allows {allowed} extra audio tracks on a video.',
  notReady: 'You can add audio tracks once the video has finished processing.',
  empty: 'Only the video’s own audio so far. Add a dub, commentary or audio description in another track.',
  duplicate: 'This video already has a track of that language and type.',
  kinds: { original: 'Original', dub: 'Dub', commentary: 'Commentary', description: 'Audio description' },
  states: {
    processing: 'Processing',
    checking: 'Checking',
    in_review: 'In review',
    rejected: 'Not approved',
    ready: 'Ready',
    failed: 'Failed',
  },
  uploading: 'Uploading {percent}%',
  resume: 'Upload stopped. Choose the same file to continue.',
  failedReasons: {
    processing_failed: 'This file could not be processed.',
    unreadable_file: 'No audio could be read from this file.',
    other: 'This track could not be prepared.',
  },
  isDefault: 'Default',
  makeDefault: 'Make default',
  edit: 'Edit',
  delete: 'Delete',
  retry: 'Try again',
  save: 'Save',
  cancel: 'Cancel',
  updating: 'Updating the player’s tracks…',
  form: {
    addTitle: 'Add audio track',
    editTitle: 'Edit audio track',
    source: 'Source',
    sourceUpload: 'Upload a file',
    sourceStream: 'From this video’s file',
    file: 'Audio file',
    fileHint: 'MP3, M4A, AAC, WAV, FLAC, OGG, Opus, MP4 or WebM, up to {size}.',
    fileTooBig: 'This file is larger than {size}.',
    fileType: 'Choose an MP3, M4A, AAC, WAV, FLAC, OGG, Opus, MP4 or WebM file.',
    pickStream: 'Choose a track',
    stream: 'Track {n} · {details}',
    look: 'Look for tracks',
    looking: 'Looking for tracks in the video file…',
    noneFound: 'No other audio tracks were found in this video’s file.',
    language: 'Language',
    label: 'Name in the player',
    labelHint: 'Viewers see this name in the player settings.',
    kind: 'Type',
    makeDefault: 'Play this track first',
    originalLanguage: 'Language of the video’s own audio',
    submit: 'Add track',
  },
  deleteTitle: 'Delete this audio track?',
  deleteBody: 'Viewers will no longer hear “{label}”. This cannot be undone.',
  loadFailed: 'Audio tracks could not be loaded.',
  saveFailed: 'The track could not be saved. Try again.',
  uploadFailed: 'The upload stopped. Try again.',
  deleteFailed: 'The track could not be deleted. Try again.',
  retryFailed: 'The track could not be restarted. Try again.',
  lookFailed: 'The video file could not be checked. Try again.',
  added: 'Track added. It will be ready after processing.',
  saved: 'Track saved.',
  deleted: 'Track deleted.',
};

export const AUDIO_TRACKS_AR: AudioTracksTranslations = {
  title: 'المسارات الصوتية',
  hint: 'أضف دبلجة أو تعليقًا أو وصفًا صوتيًا. يختار المشاهدون المسار من إعدادات المشغل.',
  used: 'المسموح: {allowedTracks} · المستخدم: {used}',
  usedUnlimited: 'أُضيف {used} من المسارات الصوتية',
  add: 'إضافة مسار صوتي',
  notIncluded: 'لا تشمل فئة صانع المحتوى الخاصة بك مسارات صوتية إضافية.',
  limitReached: 'تسمح فئة صانع المحتوى الخاصة بك بـ {allowed} من المسارات الصوتية الإضافية لكل مرئي.',
  notReady: 'يمكنك إضافة مسارات صوتية بعد انتهاء معالجة المرئي.',
  empty: 'لا يوجد حتى الآن سوى صوت المرئي الأصلي. أضف دبلجة أو تعليقًا أو وصفًا صوتيًا في مسار آخر.',
  duplicate: 'لهذا المرئي مسار بهذه اللغة وهذا النوع بالفعل.',
  kinds: { original: 'الأصلي', dub: 'دبلجة', commentary: 'تعليق', description: 'وصف صوتي' },
  states: {
    processing: 'قيد المعالجة',
    checking: 'قيد الفحص',
    in_review: 'قيد المراجعة',
    rejected: 'غير مقبول',
    ready: 'جاهز',
    failed: 'تعذّر',
  },
  uploading: 'جارٍ الرفع {percent}٪',
  resume: 'توقف الرفع. اختر الملف نفسه للمتابعة.',
  failedReasons: {
    processing_failed: 'تعذّرت معالجة هذا الملف.',
    unreadable_file: 'تعذّرت قراءة الصوت من هذا الملف.',
    other: 'تعذّر تجهيز هذا المسار.',
  },
  isDefault: 'الافتراضي',
  makeDefault: 'اجعله الافتراضي',
  edit: 'تعديل',
  delete: 'حذف',
  retry: 'أعد المحاولة',
  save: 'حفظ',
  cancel: 'إلغاء',
  updating: 'جارٍ تحديث مسارات المشغل…',
  form: {
    addTitle: 'إضافة مسار صوتي',
    editTitle: 'تعديل المسار الصوتي',
    source: 'المصدر',
    sourceUpload: 'رفع ملف',
    sourceStream: 'من ملف هذا المرئي',
    file: 'الملف الصوتي',
    fileHint: 'MP3 أو M4A أو AAC أو WAV أو FLAC أو OGG أو Opus أو MP4 أو WebM، حتى {size}.',
    fileTooBig: 'حجم هذا الملف أكبر من {size}.',
    fileType: 'اختر ملف MP3 أو M4A أو AAC أو WAV أو FLAC أو OGG أو Opus أو MP4 أو WebM.',
    pickStream: 'اختر مسارًا',
    stream: 'المسار {n} · {details}',
    look: 'البحث عن مسارات',
    looking: 'جارٍ البحث عن مسارات في ملف المرئي…',
    noneFound: 'لم يُعثر على مسارات صوتية أخرى في ملف هذا المرئي.',
    language: 'اللغة',
    label: 'الاسم في المشغل',
    labelHint: 'يرى المشاهدون هذا الاسم في إعدادات المشغل.',
    kind: 'النوع',
    makeDefault: 'شغّل هذا المسار أولًا',
    originalLanguage: 'لغة الصوت الأصلي للمرئي',
    submit: 'إضافة المسار',
  },
  deleteTitle: 'حذف هذا المسار الصوتي؟',
  deleteBody: 'لن يسمع المشاهدون «{label}» بعد الآن. لا يمكن التراجع عن ذلك.',
  loadFailed: 'تعذّر تحميل المسارات الصوتية.',
  saveFailed: 'تعذّر حفظ المسار. أعد المحاولة.',
  uploadFailed: 'توقف الرفع. أعد المحاولة.',
  deleteFailed: 'تعذّر حذف المسار. أعد المحاولة.',
  retryFailed: 'تعذّرت إعادة تشغيل المسار. أعد المحاولة.',
  lookFailed: 'تعذّر فحص ملف المرئي. أعد المحاولة.',
  added: 'أُضيف المسار. سيكون جاهزًا بعد المعالجة.',
  saved: 'حُفظ المسار.',
  deleted: 'حُذف المسار.',
};
