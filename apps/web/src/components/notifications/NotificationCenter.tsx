'use client';

/**
 * Real-time notification toasts, bottom-end (above the phone tab bar and the
 * mini player), layered under the header so its open menus stay on top.
 *
 * Same-kind notifications arriving together become one toast ("3 videos
 * finished processing", View all); at most MAX_VISIBLE_GROUPS toasts show and
 * the rest collapse into "+N more"; repeats are dropped (lib/notifications/toast-queue).
 * Nothing here touches the notification center or the bell count: the bell
 * counts every notification on its own subscription.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from '@/components/common/AppLink';
import { usePathname } from 'next/navigation';
import { AlertCircle, Bell, Heart, MessageCircle, Radio, ShieldAlert, UserPlus, Video, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { resolveNotificationText } from '@/lib/websocket/notification-text';
import { localizeActionUrl } from '@/lib/notifications/render';
import { publishUploadResult, videoIdFromActionUrl } from '@/lib/notifications/upload-results';
import {
  EMPTY_QUEUE,
  TOAST_TTL_MS,
  contentKey,
  dismissGroup,
  enqueueToast,
  expireGroups,
  groupText,
  isAlreadyOnScreen,
  pluralText,
  resumeGroups,
  visibleToasts,
  type ToastGroup,
  type ToastQueue,
} from '@/lib/notifications/toast-queue';
import { logger } from '@/lib/logger-client';
import type { NotificationEvent } from '@/interfaces/websocket';
import './realtime-toasts.css';

/** Bulk arrivals settle into one screen-reader announcement after this long. */
const ANNOUNCE_DELAY_MS = 1200;

function KindIcon({ kind }: { kind: string }) {
  const props = { className: 'rt-icon', 'aria-hidden': true } as const;
  switch (kind) {
    case 'uploadReady':
    case 'upload':
    case 'newVideo':
      return <Video {...props} />;
    case 'uploadFailed':
      return <AlertCircle {...props} />;
    case 'newComment':
    case 'commentReply':
    case 'comment':
      return <MessageCircle {...props} />;
    case 'newSubscriber':
    case 'subscription':
      return <UserPlus {...props} />;
    case 'liveStarted':
      return <Radio {...props} />;
    case 'like':
      return <Heart {...props} />;
    case 'accountWarning':
    case 'reviewRejected':
    case 'reviewNeeded':
      return <ShieldAlert {...props} />;
    case 'reviewApproved':
      return <Video {...props} />;
    default:
      return <Bell {...props} />;
  }
}

export function NotificationCenter() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const pathname = usePathname() ?? '';
  const texts = t.notificationCenter.toasts;

  const [queue, setQueue] = useState<ToastQueue>(EMPTY_QUEUE);
  const [announcement, setAnnouncement] = useState('');
  const [paused, setPaused] = useState(false);
  const pausedAtRef = useRef<number | null>(null);
  const regionRef = useRef<HTMLElement>(null);

  // The socket callback is subscribed once; it reads the latest values through refs
  const live = useRef({ t, lang, pathname });
  useEffect(() => {
    live.current = { t, lang, pathname };
  }, [t, lang, pathname]);

  const onEvent = useCallback((data: unknown) => {
    if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'notification') return;
    const event = data as NotificationEvent;
    const { t: tNow, lang: langNow, pathname: path } = live.current;
    const kind = event.notificationKey ?? event.notificationType;

    if (kind === 'uploadReady' || kind === 'uploadFailed') {
      const videoId = videoIdFromActionUrl(event.actionUrl);
      if (videoId) publishUploadResult(videoId, kind === 'uploadReady' ? 'ready' : 'failed');
    }

    const href = localizeActionUrl(event.actionUrl, langNow);
    if (isAlreadyOnScreen(kind, href, path)) {
      logger.debug('[NotificationCenter] No toast: already on screen', { kind, path });
      return;
    }
    const { title, message } = resolveNotificationText(event, tNow, langNow);
    const at = Date.now();
    const id = event.notificationId || contentKey({ kind, href, message });
    setQueue((q) => enqueueToast(q, { id, kind, title, message, href, at }));
  }, []);

  // Every signed-in session is subscribed to `user:<id>`; notifications reach all subscribers
  useWebSocketSubscription(user?.id ? `user:${user.id}` : '', onEvent, [user?.id]);

  // Signing out (or switching account) drops the previous user's toasts
  useEffect(() => {
    setQueue(EMPTY_QUEUE);
  }, [user?.id]);

  // Expire groups on their own timers; paused while the pointer or focus is on a toast
  useEffect(() => {
    if (paused || queue.groups.length === 0) return;
    const next = Math.min(...queue.groups.map((g) => g.lastAt)) + TOAST_TTL_MS - Date.now();
    const timer = setTimeout(() => setQueue((q) => expireGroups(q, Date.now())), Math.max(0, next));
    return () => clearTimeout(timer);
  }, [queue.groups, paused]);

  // The region unmounts with its last toast (no blur/mouseleave then): start unpaused next time
  useEffect(() => {
    if (queue.groups.length > 0) return;
    pausedAtRef.current = null;
    setPaused(false);
  }, [queue.groups.length]);

  const pause = useCallback(() => {
    if (pausedAtRef.current === null) pausedAtRef.current = Date.now();
    setPaused(true);
  }, []);
  const resume = useCallback(() => {
    // Still hovered or focused: stay paused
    const region = regionRef.current;
    if (region && (region.matches(':hover') || region.contains(document.activeElement))) return;
    const since = pausedAtRef.current;
    pausedAtRef.current = null;
    if (since !== null) setQueue((q) => resumeGroups(q, Date.now() - since));
    setPaused(false);
  }, []);

  const { visible, hiddenCount } = visibleToasts(queue);
  const newest: ToastGroup | undefined = queue.groups[0];
  const newestText = newest ? groupText(newest, texts, lang) : null;
  const announceKey = newest ? `${newest.id}:${newest.entries.length}` : '';

  // One polite announcement per burst: a bulk upload is announced once, with the final count
  useEffect(() => {
    if (!announceKey || !newestText) return;
    const text = `${newestText.title}. ${newestText.message}`;
    const timer = setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
    // newestText follows announceKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announceKey]);

  const dismiss = useCallback((groupId: string, moveFocus: boolean) => {
    if (moveFocus) {
      // Keep keyboard users in the region: focus the next toast's close button
      const buttons = [...(regionRef.current?.querySelectorAll<HTMLButtonElement>('.rt-close') ?? [])];
      const index = buttons.findIndex((b) => b.dataset.group === groupId);
      const target = buttons[index + 1] ?? buttons[index - 1];
      target?.focus();
    }
    setQueue((q) => dismissGroup(q, groupId));
  }, []);

  const timeFormat = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="realtime-toast-announcer">
        {announcement}
      </div>
      {visible.length > 0 && (
        <section
          ref={regionRef}
          className="rt-toasts"
          aria-label={texts.region}
          data-testid="realtime-toasts"
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocus={pause}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
          }}
        >
          <ul className="rt-list">
            {visible.map((group) => {
              const text = groupText(group, texts, lang);
              const count = group.entries.length;
              return (
                <li
                  key={group.id}
                  className={`rt-toast toast${group.kind === 'uploadFailed' ? ' err' : ''}`}
                  data-testid="realtime-toast"
                  data-kind={group.kind}
                  data-count={count}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      dismiss(group.id, true);
                    }
                  }}
                >
                  <KindIcon kind={group.kind} />
                  <div className="rt-body">
                    <p className="rt-title">{text.title}</p>
                    <p className="rt-message" data-testid="realtime-toast-message">{text.message}</p>
                    <div className="rt-foot">
                      {text.href && (
                        <Link
                          href={text.href}
                          className="rt-action"
                          data-testid="realtime-toast-action"
                          onClick={() => dismiss(group.id, false)}
                        >
                          {text.action}
                        </Link>
                      )}
                      <time className="rt-time" dateTime={new Date(group.lastAt).toISOString()}>
                        {timeFormat.format(group.lastAt)}
                      </time>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rt-close"
                    data-group={group.id}
                    data-testid="realtime-toast-close"
                    aria-label={texts.dismiss}
                    title={texts.dismiss}
                    onClick={(e) => dismiss(group.id, e.detail === 0)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {hiddenCount > 0 && (
            <Link href={`/${lang}/notifications`} className="rt-more" data-testid="realtime-toast-more">
              {pluralText(texts.more, hiddenCount, lang)}
            </Link>
          )}
        </section>
      )}
    </>
  );
}
