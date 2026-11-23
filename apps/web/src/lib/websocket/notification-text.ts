import { fillTemplate } from '@al-ummah/shared-types';
import type { NotificationEvent, RealtimeNotificationKey } from '@/interfaces/websocket';
import type { AppTranslations } from '@/lib/i18n/types';

type RealtimeTexts = AppTranslations['notifications']['realtime'];

// accountWarning reads t.notificationCenter.accountWarning (its reason is translated too)
const KEY_TO_TEXT: Record<Exclude<RealtimeNotificationKey, 'accountWarning'>, { title: keyof RealtimeTexts; message: keyof RealtimeTexts }> = {
  newComment: { title: 'newCommentTitle', message: 'newCommentMessage' },
  newSubscriber: { title: 'newSubscriberTitle', message: 'newSubscriberMessage' },
  uploadReady: { title: 'uploadReadyTitle', message: 'uploadReadyMessage' },
  uploadFailed: { title: 'uploadFailedTitle', message: 'uploadFailedMessage' },
  newVideo: { title: 'newVideoTitle', message: 'newVideoMessage' },
  liveStarted: { title: 'liveStartedTitle', message: 'liveStartedMessage' },
  liveSoon: { title: 'liveSoonTitle', message: 'liveSoonMessage' },
  premiereCancelled: { title: 'premiereCancelledTitle', message: 'premiereCancelledMessage' },
  commentReply: { title: 'commentReplyTitle', message: 'commentReplyMessage' },
  reviewApproved: { title: 'reviewApprovedTitle', message: 'reviewApprovedMessage' },
  reviewRejected: { title: 'reviewRejectedTitle', message: 'reviewRejectedMessage' },
  reviewNeeded: { title: 'reviewNeededTitle', message: 'reviewNeededMessage' },
  channelInviteReceived: { title: 'channelInviteReceivedTitle', message: 'channelInviteReceivedMessage' },
  channelInviteAccepted: { title: 'channelInviteAcceptedTitle', message: 'channelInviteAcceptedMessage' },
  channelRoleChanged: { title: 'channelRoleChangedTitle', message: 'channelRoleChangedMessage' },
  channelMemberRemoved: { title: 'channelMemberRemovedTitle', message: 'channelMemberRemovedMessage' },
  channelMemberLeft: { title: 'channelMemberLeftTitle', message: 'channelMemberLeftMessage' },
  tierRequestApproved: { title: 'tierRequestApprovedTitle', message: 'tierRequestApprovedMessage' },
  tierRequestDeclined: { title: 'tierRequestDeclinedTitle', message: 'tierRequestDeclinedMessage' },
  tierRequestReceived: { title: 'tierRequestReceivedTitle', message: 'tierRequestReceivedMessage' },
  tierChanged: { title: 'tierChangedTitle', message: 'tierChangedMessage' },
  channelMovedIn: { title: 'channelMovedInTitle', message: 'channelMovedInMessage' },
  channelMovedOutByTeam: { title: 'channelMovedOutByTeamTitle', message: 'channelMovedOutByTeamMessage' },
  channelMovedOutByTeamWithReason: { title: 'channelMovedOutByTeamTitle', message: 'channelMovedOutByTeamWithReasonMessage' },
  youtubeImportFinished: { title: 'youtubeImportFinishedTitle', message: 'youtubeImportFinishedMessage' },
};

const CHANNEL_TEAM_KEYS = new Set<string>(['channelInviteReceived', 'channelInviteAccepted', 'channelRoleChanged', 'channelMemberRemoved', 'channelMemberLeft']);

/** Numbers in the viewer's digits (Arabic ٠–٩), strings as sent. */
function interpolate(template: string, params: Record<string, string | number> = {}, lang = 'en'): string {
  return fillTemplate(lang, template, params, '');
}

/**
 * Params in the viewer's language: a `<name>_<lang>` param (e.g. `channelName_ar`, api-videos
 * lib/channelName.ts) replaces `<name>`, so a channel's Arabic name shows on Arabic pages.
 */
export function localizeParams(params: Record<string, string | number> | undefined, lang?: string): Record<string, string | number> {
  if (!params || !lang) return params ?? {};
  const out: Record<string, string | number> = { ...params };
  const suffix = `_${lang}`;
  for (const [key, value] of Object.entries(params)) {
    if (key.endsWith(suffix) && value !== '' && value !== undefined) out[key.slice(0, -suffix.length)] = value;
  }
  return out;
}

/**
 * Render a server-pushed notification in the viewer's language.
 * Servers send `notificationKey` + `params`; legacy events with pre-rendered
 * `title`/`message` are passed through, and unknown keys fall back to the
 * generic per-type labels.
 */
export function resolveNotificationText(
  input: NotificationEvent,
  t: AppTranslations,
  lang?: string
): { title: string; message: string } {
  const fill = (template: string, params?: Record<string, string | number>) => interpolate(template, params, lang);
  const event: NotificationEvent = { ...input, params: localizeParams(input.params as Record<string, string | number> | undefined, lang) as NotificationEvent['params'] };
  // Upload results read the current copy (uploadStatus.notification): stored
  // translation files keep older values for the realtime.* keys
  const upload = t.uploadStatus?.notification;
  if (upload && (event.notificationKey === 'uploadReady' || event.notificationKey === 'uploadFailed')) {
    const ready = event.notificationKey === 'uploadReady';
    return {
      title: fill(ready ? upload.readyTitle : upload.failedTitle, event.params),
      message: fill(ready ? upload.readyMessage : upload.failedMessage, event.params),
    };
  }

  // A moderator's warning: the reason code becomes words in the viewer's language
  const warning = t.notificationCenter?.accountWarning;
  if (warning && event.notificationKey === 'accountWarning') {
    const code = String(event.params?.reason ?? 'other');
    const reasons = warning.reasons as Record<string, string>;
    const params = { ...event.params, reason: reasons[code] ?? reasons.other };
    return { title: fill(warning.title, params), message: fill(warning.message, params) };
  }

  // Channel team notifications send the role as a code: it reads as the reader's role name
  if (event.params && typeof event.params.role === 'string' && CHANNEL_TEAM_KEYS.has(event.notificationKey as string)) {
    const roles = t.channelRoles?.roles as Record<string, string> | undefined;
    const role = roles?.[event.params.role];
    if (role) event.params = { ...event.params, role } as NotificationEvent['params'];
  }

  const mapping = event.notificationKey && event.notificationKey !== 'accountWarning' ? KEY_TO_TEXT[event.notificationKey] : undefined;
  if (mapping) {
    const texts = t.notifications.realtime;
    return {
      title: fill(texts[mapping.title], event.params),
      message: fill(texts[mapping.message], event.params),
    };
  }

  const fallbackTitle: Record<NotificationEvent['notificationType'], string> = {
    like: t.notifications.likeNotification,
    comment: t.notifications.commentNotification,
    subscription: t.notifications.subscriptionNotification,
    upload: t.notifications.uploadNotification,
    system: t.notifications.systemNotification,
  };
  return {
    title: event.title || fallbackTitle[event.notificationType] || t.notifications.systemNotification,
    message: event.message || '',
  };
}

/** One key's templates: `{name}` placeholders, filled from the notification's params. */
export interface NotificationTemplate {
  title: string;
  message: string;
  /** accountWarning: the reason code → words (`{reason}`). */
  reasons?: Record<string, string>;
}

/**
 * Every stored notification key's templates in one language, as resolveNotificationText reads
 * them: the Web Push service worker (/push-sw.js) renders with these, so a pushed
 * notification reads like the same row in the notification center.
 */
export function notificationTemplates(t: AppTranslations): Record<RealtimeNotificationKey, NotificationTemplate> {
  const texts = t.notifications.realtime;
  const out = {} as Record<RealtimeNotificationKey, NotificationTemplate>;
  for (const [key, mapping] of Object.entries(KEY_TO_TEXT) as Array<[Exclude<RealtimeNotificationKey, 'accountWarning'>, (typeof KEY_TO_TEXT)[keyof typeof KEY_TO_TEXT]]>) {
    out[key] = { title: texts[mapping.title], message: texts[mapping.message] };
  }
  const upload = t.uploadStatus?.notification;
  if (upload) {
    out.uploadReady = { title: upload.readyTitle, message: upload.readyMessage };
    out.uploadFailed = { title: upload.failedTitle, message: upload.failedMessage };
  }
  const warning = t.notificationCenter.accountWarning;
  out.accountWarning = { title: warning.title, message: warning.message, reasons: { ...(warning.reasons as Record<string, string>) } };
  return out;
}
