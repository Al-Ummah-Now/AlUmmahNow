'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, MessageCircle, Radio, Trash2, UserPlus, Video, AlertCircle, Check } from 'lucide-react';
import type { NotificationItem } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { localizeActionUrl, relativeTime, renderNotification } from '@/lib/notifications/render';

function Icon({ item }: { item: NotificationItem }) {
  const cls = 'h-5 w-5 flex-shrink-0';
  switch (item.notificationKey) {
    case 'liveStarted':
      return <Radio className={`${cls} text-red-500`} aria-hidden="true" />;
    case 'newVideo':
      return <Video className={`${cls} text-purple-500`} aria-hidden="true" />;
    case 'commentReply':
    case 'newComment':
      return <MessageCircle className={`${cls} text-blue-500`} aria-hidden="true" />;
    case 'newSubscriber':
      return <UserPlus className={`${cls} text-green-600`} aria-hidden="true" />;
    case 'uploadFailed':
      return <AlertCircle className={`${cls} text-orange-500`} aria-hidden="true" />;
    case 'uploadReady':
      return <Video className={`${cls} text-emerald-600`} aria-hidden="true" />;
    default:
      return <Bell className={`${cls} text-gray-500`} aria-hidden="true" />;
  }
}

interface NotificationRowProps {
  item: NotificationItem;
  onOpen?: (item: NotificationItem) => void;
  onMarkRead?: (item: NotificationItem) => void;
  onDelete?: (item: NotificationItem) => void;
  compact?: boolean;
}

/**
 * One notification, rendered in the viewer's language. Uses logical
 * (start/end) spacing so the same markup works in LTR and RTL.
 */
export function NotificationRow({ item, onOpen, onMarkRead, onDelete, compact = false }: NotificationRowProps) {
  const { t, lang } = useLanguage();
  const { title, message } = renderNotification(item, t);
  const href = localizeActionUrl(item.actionUrl, lang);
  const texts = t.notificationCenter;

  const body = (
    <div className="flex items-start gap-3 min-w-0 flex-1">
      <Icon item={item} />
      <div className="min-w-0 flex-1 text-start">
        <p className={`text-sm ${item.isRead ? 'text-gray-700 dark:text-gray-300' : 'font-semibold text-gray-900 dark:text-white'}`}>{title}</p>
        {message && <p className={`text-sm text-gray-600 dark:text-gray-400 ${compact ? 'line-clamp-2' : ''}`}>{message}</p>}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          <time dateTime={item.createdAt}>{relativeTime(item.createdAt, t, lang)}</time>
        </p>
      </div>
      {!item.isRead && (
        <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-blue-600 flex-shrink-0" aria-label={texts.unreadDot} role="img" />
      )}
    </div>
  );

  return (
    <li
      data-testid="notification-item"
      data-notification-id={item.id}
      data-read={item.isRead ? 'true' : 'false'}
      className={`flex items-start gap-2 px-3 py-3 ${item.isRead ? '' : 'bg-blue-50/60 dark:bg-blue-900/20'} hover:bg-gray-50 dark:hover:bg-gray-800`}
    >
      {href ? (
        <Link href={href} onClick={() => onOpen?.(item)} className="flex min-w-0 flex-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {body}
        </Link>
      ) : (
        body
      )}
      {(onMarkRead || onDelete) && (
        <div className="flex flex-shrink-0 items-center gap-1">
          {onMarkRead && !item.isRead && (
            <button
              type="button"
              onClick={() => onMarkRead(item)}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={texts.markRead}
              title={texts.markRead}
              data-testid="notification-mark-read"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item)}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
