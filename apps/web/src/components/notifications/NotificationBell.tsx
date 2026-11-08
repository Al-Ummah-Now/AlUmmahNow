'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Settings } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useNotificationBell } from '@/hooks/useNotificationBell';
import { fillTemplate } from '@/lib/i18n/translations/library-notifications';
import { NotificationRow } from './NotificationRow';

interface NotificationBellProps {
  /** Text direction of the surrounding header; the dropdown opens toward the page. */
  dir?: 'ltr' | 'rtl';
}

/**
 * Header bell (Story 29.10): unread badge with realtime increments and a
 * dropdown of the latest notifications. Signed-in users only.
 */
export function NotificationBell({ dir = 'ltr' }: NotificationBellProps) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const texts = t.notificationCenter;
  const { unreadCount, latest, isLoading, error, loadLatest, markRead, markAllRead } = useNotificationBell(user?.id);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadLatest();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, loadLatest, close]);

  if (!user) return null;

  const badge = unreadCount > 99 ? '99+' : unreadCount.toLocaleString(lang);
  // The name carries the badge exactly as shown ("99+", Arabic-Indic digits) so it
  // contains the visible text (WCAG 2.5.3 label-in-name)
  const label = unreadCount > 0 ? fillTemplate(texts.bellLabelUnread, { count: badge }) : texts.bellLabel;

  return (
    <div className="relative" ref={containerRef} dir={dir}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 text-[#ffa037] hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffa037]"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        data-testid="notification-bell"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -top-0.5 -end-0.5 min-w-[1.1rem] h-[1.1rem] rounded-full bg-red-600 px-1 text-[0.65rem] font-bold leading-[1.1rem] text-white text-center"
            aria-hidden="true"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={texts.latest}
          data-testid="notification-dropdown"
          className="absolute end-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{texts.title}</h2>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  data-testid="notification-mark-all-read"
                >
                  {texts.markAllRead}
                </button>
              )}
              <Link
                href={`/${lang}/settings#notifications`}
                onClick={() => close()}
                className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label={texts.settings}
                title={texts.settings}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {isLoading && latest.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500" role="status">{t.common.loading}</p>
            ) : error && latest.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-red-600" role="alert">{texts.loadError}</p>
            ) : latest.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500" data-testid="notification-empty">{texts.empty}</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {latest.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    compact
                    onOpen={(n) => {
                      if (!n.isRead) void markRead(n.id);
                      close();
                    }}
                  />
                ))}
              </ul>
            )}
          </div>

          <Link
            href={`/${lang}/notifications`}
            onClick={() => close()}
            className="block border-t border-gray-200 px-3 py-2 text-center text-sm font-medium text-blue-700 hover:bg-gray-50 dark:border-gray-700 dark:text-blue-300 dark:hover:bg-gray-800"
            data-testid="notification-see-all"
          >
            {texts.seeAll}
          </Link>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
