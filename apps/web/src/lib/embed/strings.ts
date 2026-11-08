/**
 * UI strings for embed frames and the share dialog (en / ar).
 * Kept here, not in the API-synced translation bundle, so the embed shell
 * renders without the translations fetch.
 */

import type { EmbedLang } from './params';

export interface EmbedStrings {
  brand: string;
  play: string;
  playVideo: string;
  watchOn: string;
  unavailableTitle: string;
  unavailableBody: string;
  goToSite: string;
  playlist: string;
  playlistCount: string;
  nowPlaying: string;
  comments: string;
  noComments: string;
  loadMore: string;
  joinDiscussion: string;
  replies: string;
  pinned: string;
  playerFrameTitle: string;
  share: string;
  shareTitle: string;
  copyLink: string;
  copied: string;
  startAt: string;
  embed: string;
  copyEmbed: string;
  size: string;
  responsive: string;
  shareVia: string;
  moreOptions: string;
  close: string;
  whatsapp: string;
  telegram: string;
  x: string;
  facebook: string;
  email: string;
}

const en: EmbedStrings = {
  brand: 'Al Ummah Now',
  play: 'Play',
  playVideo: 'Play video: {title}',
  watchOn: 'Watch on Al Ummah Now',
  unavailableTitle: 'This video is unavailable',
  unavailableBody: 'It may be private, removed, or not published yet.',
  goToSite: 'Go to Al Ummah Now',
  playlist: 'Playlist',
  playlistCount: '{count} videos',
  nowPlaying: 'Now playing',
  comments: 'Comments',
  noComments: 'No comments yet.',
  loadMore: 'Load more',
  joinDiscussion: 'Join the discussion on Al Ummah Now',
  replies: '{count} replies',
  pinned: 'Pinned',
  playerFrameTitle: 'Al Ummah Now video player',
  share: 'Share',
  shareTitle: 'Share this video',
  copyLink: 'Copy link',
  copied: 'Copied',
  startAt: 'Start at {time}',
  embed: 'Embed',
  copyEmbed: 'Copy embed code',
  size: 'Size',
  responsive: 'Responsive',
  shareVia: 'Share via',
  moreOptions: 'More options',
  close: 'Close',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  x: 'X',
  facebook: 'Facebook',
  email: 'Email',
};

const ar: EmbedStrings = {
  brand: 'الأمة الآن',
  play: 'تشغيل',
  playVideo: 'تشغيل الفيديو: {title}',
  watchOn: 'شاهد على الأمة الآن',
  unavailableTitle: 'هذا الفيديو غير متاح',
  unavailableBody: 'قد يكون خاصًا أو محذوفًا أو لم يُنشر بعد.',
  goToSite: 'الذهاب إلى الأمة الآن',
  playlist: 'قائمة التشغيل',
  playlistCount: '{count} فيديو',
  nowPlaying: 'قيد التشغيل',
  comments: 'التعليقات',
  noComments: 'لا توجد تعليقات بعد.',
  loadMore: 'عرض المزيد',
  joinDiscussion: 'شارك في النقاش على الأمة الآن',
  replies: '{count} ردود',
  pinned: 'مثبّت',
  playerFrameTitle: 'مشغل فيديو الأمة الآن',
  share: 'مشاركة',
  shareTitle: 'مشاركة هذا الفيديو',
  copyLink: 'نسخ الرابط',
  copied: 'تم النسخ',
  startAt: 'البدء عند {time}',
  embed: 'تضمين',
  copyEmbed: 'نسخ رمز التضمين',
  size: 'الحجم',
  responsive: 'متجاوب',
  shareVia: 'مشاركة عبر',
  moreOptions: 'خيارات أخرى',
  close: 'إغلاق',
  whatsapp: 'واتساب',
  telegram: 'تيليجرام',
  x: 'إكس',
  facebook: 'فيسبوك',
  email: 'البريد الإلكتروني',
};

export function embedStrings(lang: EmbedLang | string): EmbedStrings {
  return lang === 'ar' ? ar : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in values ? String(values[key]) : `{${key}}`));
}
