/**
 * After-upload status (upload page, single and batch), en/ar. Shared by the web
 * static fallback and the api-videos translation seed, like i18n-contact.ts.
 *
 * The bytes are done when these show; processing runs on the server and the
 * uploader is notified when it ends. Batch copy never invites leaving the page:
 * the other files still upload from this browser tab.
 * Placeholders: {title}, {videoTitle}, {completed}, {total}.
 *
 * Copy that replaces older strings lives here under new keys on purpose: each
 * environment's translation store (admin Translations page) overrides the
 * static strings for keys it already has, and only gains new keys.
 */

export interface UploadStatusTranslations {
  /** Single upload: heading once the bytes are uploaded */
  completeTitle: string;
  /** Single upload: what happens next while processing */
  processingBody: string;
  readyTitle: string;
  readyBody: string;
  failedTitle: string;
  failedBody: string;
  /** Step track: uploaded → processing → ready */
  steps: { uploaded: string; processing: string; ready: string; failed: string };
  /** Accessible name of the step track */
  stepsLabel: string;
  viewVideo: string;
  /** Link to the video's edit page (the studio) when processing failed */
  editVideo: string;
  uploadAnother: string;
  /** Batch row status once its bytes are uploaded */
  row: { processing: string; ready: string; failed: string };
  /** Batch: shown while any file is still uploading from this tab */
  batchKeepOpen: string;
  /** Batch: every file uploaded, some still processing */
  batchProcessing: string;
  /** Batch: every uploaded file processed */
  batchAllReady: string;
  /** Screen-reader announcements when a status changes */
  announceReady: string;
  announceFailed: string;
  /** Upload page while the bytes upload */
  uploadingKeepOpen: string;
  /** Batch: label and count of files whose bytes are uploaded (not yet watchable) */
  uploadedLabel: string;
  uploadedCount: string;
  /** The uploader's notification (center, toast) when processing ends */
  notification: { readyTitle: string; readyMessage: string; failedTitle: string; failedMessage: string };
}

export const UPLOAD_STATUS_EN: UploadStatusTranslations = {
  completeTitle: 'Upload complete',
  processingBody: "We're processing your video. It will be available once processing finishes, and we'll notify you when it's ready.",
  readyTitle: 'Your video is ready',
  readyBody: 'Processing has finished and your video is ready to watch.',
  failedTitle: "Your video couldn't be processed",
  failedBody: "Something went wrong while we processed it. Open it in Edit Video to see what happened and what you can do.",
  steps: { uploaded: 'Uploaded', processing: 'Processing', ready: 'Ready', failed: "Couldn't be processed" },
  stepsLabel: 'Upload progress',
  viewVideo: 'View video',
  editVideo: 'Edit Video',
  uploadAnother: 'Upload another video',
  row: { processing: 'Uploaded · Processing', ready: 'Ready', failed: "Couldn't be processed" },
  batchKeepOpen:
    "Keep this page open until all uploads finish. Processing continues on our side after that, and we'll notify you when each video is ready.",
  batchProcessing: "All uploads finished. We're processing your videos and will notify you when each one is ready.",
  batchAllReady: 'All your videos are processed and ready to watch.',
  announceReady: '"{title}" is ready to watch',
  announceFailed: '"{title}" couldn\'t be processed',
  uploadingKeepOpen: 'Your video is uploading. Keep this page open until the upload finishes.',
  uploadedLabel: 'Uploaded',
  uploadedCount: '{completed} of {total} uploaded',
  notification: {
    readyTitle: 'Video ready',
    readyMessage: 'Your video "{videoTitle}" is ready to watch',
    failedTitle: 'Processing failed',
    failedMessage: '"{videoTitle}" couldn\'t be processed',
  },
};

export const UPLOAD_STATUS_AR: UploadStatusTranslations = {
  completeTitle: 'اكتمل الرفع',
  processingBody: 'نعالج الفيديو الآن. سيكون متاحًا عند انتهاء المعالجة، وسنُعلمك حين يصبح جاهزًا.',
  readyTitle: 'الفيديو جاهز',
  readyBody: 'انتهت المعالجة والفيديو جاهز للمشاهدة.',
  failedTitle: 'تعذّرت معالجة الفيديو',
  failedBody: 'حدث خطأ أثناء المعالجة. افتحه في «تعديل الفيديو» لمعرفة ما حدث وما يمكنك فعله.',
  steps: { uploaded: 'تم الرفع', processing: 'المعالجة', ready: 'جاهز', failed: 'تعذّرت المعالجة' },
  stepsLabel: 'مراحل الرفع',
  viewVideo: 'مشاهدة الفيديو',
  editVideo: 'تعديل الفيديو',
  uploadAnother: 'رفع فيديو آخر',
  row: { processing: 'تم الرفع · قيد المعالجة', ready: 'جاهز', failed: 'تعذّرت المعالجة' },
  batchKeepOpen:
    'أبقِ هذه الصفحة مفتوحة حتى تنتهي جميع عمليات الرفع. تستمر المعالجة لدينا بعد ذلك، وسنُعلمك حين يصبح كل فيديو جاهزًا.',
  batchProcessing: 'انتهت جميع عمليات الرفع. نعالج الفيديوهات الآن وسنُعلمك حين يصبح كل منها جاهزًا.',
  batchAllReady: 'تمت معالجة جميع الفيديوهات وهي جاهزة للمشاهدة.',
  announceReady: '«{title}» جاهز للمشاهدة',
  announceFailed: 'تعذّرت معالجة «{title}»',
  uploadingKeepOpen: 'يجري رفع الفيديو. أبقِ هذه الصفحة مفتوحة حتى ينتهي الرفع.',
  uploadedLabel: 'تم الرفع',
  uploadedCount: 'تم رفع {completed} من {total}',
  notification: {
    readyTitle: 'الفيديو جاهز',
    readyMessage: 'الفيديو «{videoTitle}» جاهز للمشاهدة',
    failedTitle: 'تعذّرت المعالجة',
    failedMessage: 'تعذّرت معالجة «{videoTitle}»',
  },
};
