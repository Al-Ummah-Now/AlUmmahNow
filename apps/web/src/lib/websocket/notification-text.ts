import type { NotificationEvent, RealtimeNotificationKey } from '@/interfaces/websocket';
import type { AppTranslations } from '@/lib/i18n/types';

type RealtimeTexts = AppTranslations['notifications']['realtime'];

const KEY_TO_TEXT: Record<RealtimeNotificationKey, { title: keyof RealtimeTexts; message: keyof RealtimeTexts }> = {
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
 * Render a server-pushed notification in the viewer's language.
 * Servers send `notificationKey` + `params`; legacy events with pre-rendered
 * `title`/`message` are passed through, and unknown keys fall back to the
 * generic per-type labels.
 */
export function resolveNotificationText(
  event: NotificationEvent,
  t: AppTranslations
): { title: string; message: string } {
  const mapping = event.notificationKey ? KEY_TO_TEXT[event.notificationKey] : undefined;
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
