'use client';

import React from 'react';
import Link from '@/components/common/AppLink';
import { Bell, MessageCircle, Radio, Trash2, UserPlus, Video, AlertCircle, Check, Mail, ShieldAlert } from 'lucide-react';
import type { NotificationItem } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { localizeActionUrl, relativeTime, renderNotification } from '@/lib/notifications/render';

/**
 * Row colours come from the surface the row sits on: the page by default, the popover's own
 * tokens inside the header dropdown (NotificationBell sets --nr-*). Never literal colours, so
 * every site theme and custom package reads in light and dark.
 */
const TEXT = 'text-[var(--nr-text,var(--fanous-color-text-primary))]';
const SECONDARY = 'text-[var(--nr-secondary,var(--fanous-color-text-secondary))]';
const MUTED = 'text-[var(--nr-muted,var(--fanous-color-text-muted))]';

function Icon({ item }: { item: NotificationItem }) {
  // The shape tells the kind apart; one readable tone instead of hues tuned for one theme
  const cls = `h-5 w-5 flex-shrink-0 ${SECONDARY}`;
  switch (item.notificationKey) {
    case 'liveStarted':
      return <Radio className={cls} aria-hidden="true" />;
    case 'newVideo':
    case 'uploadReady':
      return <Video className={cls} aria-hidden="true" />;
    case 'commentReply':
    case 'newComment':
      return <MessageCircle className={cls} aria-hidden="true" />;
    case 'newSubscriber':
      return <UserPlus className={cls} aria-hidden="true" />;
    case 'uploadFailed':
      return <AlertCircle className={cls} aria-hidden="true" />;
    case 'accountWarning':
    case 'reviewRejected':
    case 'reviewNeeded':
      return <ShieldAlert className={cls} aria-hidden="true" />;
    case 'reviewApproved':
      return <Video className={cls} aria-hidden="true" />;
    default:
      return <Bell className={cls} aria-hidden="true" />;
  }
}

interface NotificationRowProps {
  item: NotificationItem;
  onOpen?: (item: NotificationItem) => void;
  onMarkRead?: (item: NotificationItem) => void;
  onMarkUnread?: (item: NotificationItem) => void;
  onDelete?: (item: NotificationItem) => void;
  compact?: boolean;
}

/**
 * One notification, rendered in the viewer's language. Uses logical
 * (start/end) spacing so the same markup works in LTR and RTL.
 */
export function NotificationRow({ item, onOpen, onMarkRead, onMarkUnread, onDelete, compact = false }: NotificationRowProps) {
  const { t, lang } = useLanguage();
  const { title, message } = renderNotification(item, t, lang);
  const href = localizeActionUrl(item.actionUrl, lang);
  const texts = t.notificationCenter;

  const body = (
    <div className="flex items-start gap-3 min-w-0 flex-1">
      <Icon item={item} />
      <div className="min-w-0 flex-1 text-start">
        <p className={`text-sm ${TEXT} ${item.isRead ? 'font-normal' : 'font-bold'}`}>{title}</p>
        {message && <p className={`text-sm ${SECONDARY} ${compact ? 'line-clamp-2' : ''}`}>{message}</p>}
        <p className={`text-xs ${SECONDARY} mt-1`}>
          <time dateTime={item.createdAt}>{relativeTime(item.createdAt, t, lang)}</time>
        </p>
      </div>
      {!item.isRead && (
        <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--fanous-color-primary)] ring-1 ring-[var(--nr-text,var(--fanous-color-text-primary))] flex-shrink-0" aria-label={texts.unreadDot} role="img" />
      )}
    </div>
  );

  return (
    <li
      data-testid="notification-item"
      data-notification-id={item.id}
      data-read={item.isRead ? 'true' : 'false'}
      className={`flex items-start gap-2 border-s-4 px-3 py-3 ${item.isRead ? 'border-s-transparent' : 'border-s-[var(--fanous-color-primary)] bg-[color-mix(in_srgb,var(--fanous-color-primary)_8%,transparent)]'} hover:bg-[var(--m-hover)]`}
    >
      {href ? (
        <Link href={href} onClick={() => onOpen?.(item)} className="flex min-w-0 flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-c-form-focus-ring)]">
          {body}
        </Link>
      ) : (
        body
      )}
      {(onMarkRead || onMarkUnread || onDelete) && (
        <div className="flex flex-shrink-0 items-center gap-1">
          {onMarkRead && !item.isRead && (
            <button
              type="button"
              onClick={() => onMarkRead(item)}
              className={`rounded p-1.5 ${MUTED} hover:bg-[var(--m-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-c-form-focus-ring)]`}
              aria-label={texts.markRead}
              title={texts.markRead}
              data-testid="notification-mark-read"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {onMarkUnread && item.isRead && (
            <button
              type="button"
              onClick={() => onMarkUnread(item)}
              className={`rounded p-1.5 ${MUTED} hover:bg-[var(--m-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-c-form-focus-ring)]`}
              aria-label={texts.markUnread}
              title={texts.markUnread}
              data-testid="notification-mark-unread"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item)}
              className={`rounded p-1.5 ${MUTED} hover:bg-[var(--m-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-c-form-focus-ring)]`}
              aria-label={texts.delete}
              title={texts.delete}
              data-testid="notification-delete"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}
