/** Live watch page strings (web /[locale]/live/[id]). The same page plays either live provider. */

export const LIVE_WATCH_EN = {
  live: 'Live',
  startingSoon: 'Starting soon',
  startingSoonBody: 'This stream hasn\'t started yet. It plays here as soon as it does.',
  scheduledFor: 'Scheduled for {time}',
  waiting: 'The stream will appear here when it starts.',
  ended: 'This live stream has ended.',
  recording: 'Recording',
  recordingPreparing: 'The recording is being prepared. Check back soon.',
  cancelled: 'This live stream was cancelled.',
  notFound: 'This live stream doesn\'t exist or is private.',
  loadFailed: 'Could not load this live stream.',
  retry: 'Try again',
  playerLabel: 'Live stream player',
  startedAt: 'Started {time}',
  allStreams: 'All live streams',
};

export type LiveWatchTranslations = typeof LIVE_WATCH_EN;

export const LIVE_WATCH_AR: LiveWatchTranslations = {
  live: 'مباشر',
  startingSoon: 'يبدأ قريبًا',
  startingSoonBody: 'لم يبدأ هذا البث بعد. سيُعرض هنا فور بدئه.',
  scheduledFor: 'موعده {time}',
  waiting: 'سيظهر البث هنا عند بدئه.',
  ended: 'انتهى هذا البث المباشر.',
  recording: 'التسجيل',
  recordingPreparing: 'يجري تجهيز التسجيل. عُد بعد قليل.',
  cancelled: 'أُلغي هذا البث المباشر.',
  notFound: 'هذا البث المباشر غير موجود أو خاص.',
  loadFailed: 'تعذّر تحميل هذا البث المباشر.',
  retry: 'حاول مرة أخرى',
  playerLabel: 'مشغّل البث المباشر',
  startedAt: 'بدأ {time}',
  allStreams: 'كل البثوث المباشرة',
};
