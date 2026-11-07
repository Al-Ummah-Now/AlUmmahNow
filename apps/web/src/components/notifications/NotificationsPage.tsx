'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Settings } from 'lucide-react';
import type { NotificationItem } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { NotificationsService } from '@/services/api/notifications';
import { publishUnreadCount } from '@/lib/notifications/render';
import { logger } from '@/lib/logger-client';
import { NotificationRow } from './NotificationRow';

const PAGE_SIZE = 20;

interface NotificationsPageProps {
  dir: 'ltr' | 'rtl';
}

/** Full notification inbox (Story 29.10): all/unread filter, read state, delete, load more. */
export function NotificationsPageView({ dir }: NotificationsPageProps) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const texts = t.notificationCenter;
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const updateUnread = (count: number) => {
    setUnreadCount(count);
    publishUnreadCount(count);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const page = await NotificationsService.list({ limit: PAGE_SIZE, unreadOnly: filter === 'unread' });
    if (page) {
      setItems(page.items);
      setCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
      publishUnreadCount(page.unreadCount);
    } else {
      setError(true);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const page = await NotificationsService.list({ limit: PAGE_SIZE, cursor, unreadOnly: filter === 'unread' });
    if (page) {
      setItems((prev) => [...prev, ...page.items.filter((n) => !prev.some((p) => p.id === n.id))]);
      setCursor(page.nextCursor);
    } else {
      setError(true);
    }
    setLoadingMore(false);
  };

  const markRead = async (item: NotificationItem) => {
    if (item.isRead) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
    const result = await NotificationsService.markRead([item.id]);
    if (result) updateUnread(result.unreadCount);
  };

  const markAll = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    const result = await NotificationsService.markAllRead();
    if (result) updateUnread(0);
  };

  const remove = async (item: NotificationItem) => {
    const previous = items;
    setItems((prev) => prev.filter((n) => n.id !== item.id));
    const result = await NotificationsService.remove(item.id);
    if (result) {
      updateUnread(result.unreadCount);
    } else {
      logger.warn('[NotificationsPage] Delete failed', { id: item.id });
      setItems(previous);
    }
  };

  if (!user) {
    return (
      <main dir={dir} className="mx-auto max-w-3xl px-4 py-12 text-center">
        <Bell className="mx-auto mb-3 h-10 w-10 text-gray-400" aria-hidden="true" />
        <p className="text-gray-700 dark:text-gray-300">{texts.signInPrompt}</p>
      </main>
    );
  }

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8" data-testid="notifications-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white">
          <Bell className="h-7 w-7 text-[#ffa037]" aria-hidden="true" />
          {texts.title}
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void markAll()}
            disabled={unreadCount === 0}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            data-testid="notifications-mark-all-read"
          >
            {texts.markAllRead}
          </button>
          <Link
            href={`/${lang}/settings#notifications`}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            {texts.settings}
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label={texts.title} className="mb-4 flex gap-2">
        {(['all', 'unread'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            data-testid={`notifications-filter-${value}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              filter === value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
            }`}
          >
            {value === 'all' ? texts.all : texts.unread}
            {value === 'unread' && unreadCount > 0 && <span className="ms-1">({unreadCount.toLocaleString(lang)})</span>}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500" role="status">{t.common.loading}</p>
        ) : error && items.length === 0 ? (
          <div className="px-4 py-10 text-center" role="alert">
            <p className="text-sm text-red-600">{texts.loadError}</p>
            <button type="button" onClick={() => void load()} className="mt-2 text-sm font-medium text-blue-700 underline dark:text-blue-300">
              {t.library.retry}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-gray-500" data-testid="notifications-empty">
            {filter === 'unread' ? texts.emptyUnread : texts.empty}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800" data-testid="notifications-list">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={(n) => void markRead(n)} onMarkRead={(n) => void markRead(n)} onDelete={(n) => void remove(n)} />
            ))}
          </ul>
        )}
      </div>

      {cursor && !loading && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-60 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
          >
            {loadingMore ? t.common.loading : texts.loadMore}
          </button>
        </div>
      )}
    </main>
  );
}

export default function NotificationsPage() {
  return <NotificationsPageView dir="ltr" />;
}
