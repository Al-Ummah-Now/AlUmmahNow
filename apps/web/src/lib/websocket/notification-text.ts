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
  commentReply: { title: 'commentReplyTitle', message: 'commentReplyMessage' },
};

function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (params[name] !== undefined ? String(params[name]) : ''));
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
  const event: NotificationEvent = { ...input, params: localizeParams(input.params as Record<string, string | number> | undefined, lang) as NotificationEvent['params'] };
  // Upload results read the current copy (uploadStatus.notification): stored
  // translation files keep older values for the realtime.* keys
  const upload = t.uploadStatus?.notification;
  if (upload && (event.notificationKey === 'uploadReady' || event.notificationKey === 'uploadFailed')) {
    const ready = event.notificationKey === 'uploadReady';
    return {
      title: interpolate(ready ? upload.readyTitle : upload.failedTitle, event.params),
      message: interpolate(ready ? upload.readyMessage : upload.failedMessage, event.params),
    };
  }

  // A moderator's warning: the reason code becomes words in the viewer's language
  const warning = t.notificationCenter?.accountWarning;
  if (warning && event.notificationKey === 'accountWarning') {
    const code = String(event.params?.reason ?? 'other');
    const reasons = warning.reasons as Record<string, string>;
    const params = { ...event.params, reason: reasons[code] ?? reasons.other };
    return { title: interpolate(warning.title, params), message: interpolate(warning.message, params) };
  }

  const mapping = event.notificationKey && event.notificationKey !== 'accountWarning' ? KEY_TO_TEXT[event.notificationKey] : undefined;
  if (mapping) {
    const texts = t.notifications.realtime;
    return {
      title: interpolate(texts[mapping.title], event.params),
      message: interpolate(texts[mapping.message], event.params),
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
