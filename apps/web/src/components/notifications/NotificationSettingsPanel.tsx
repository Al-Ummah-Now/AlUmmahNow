'use client';

import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationSettings } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { NotificationsService } from '@/services/api/notifications';
import { logger } from '@/lib/logger-client';

/**
 * Settings page section (Story 29.10): turn notification categories on/off.
 * Each switch saves immediately.
 */
export function NotificationSettingsPanel() {
  const { t, dir } = useLanguage();
  const texts = t.notificationCenter;
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'loadError'>('idle');
  const [saving, setSaving] = useState<NotificationCategory | null>(null);

  useEffect(() => {
    let cancelled = false;
    void NotificationsService.settings().then((s) => {
      if (cancelled) return;
      if (s) setSettings(s);
      else setStatus('loadError');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (category: NotificationCategory) => {
    if (!settings) return;
    const next = !settings[category];
    setSettings({ ...settings, [category]: next });
    setSaving(category);
    const saved = await NotificationsService.updateSettings({ [category]: next });
    setSaving(null);
    if (saved) {
      setSettings(saved);
      setStatus('saved');
    } else {
      logger.warn('[NotificationSettingsPanel] Save failed', { category });
      setSettings((s) => (s ? { ...s, [category]: !next } : s));
      setStatus('error');
    }
  };

  return (
    <section
      id="notifications"
      dir={dir}
      aria-labelledby="notification-settings-heading"
      data-testid="notification-settings"
      className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="mb-4 flex items-center gap-3">
        <Bell className="h-6 w-6 text-[var(--fanous-color-accent)]" aria-hidden="true" />
        <div>
          <h2 id="notification-settings-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {texts.settingsTitle}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{texts.settingsDescription}</p>
        </div>
      </div>

      {status === 'loadError' && (
        <p className="text-sm text-red-600" role="alert">{texts.loadError}</p>
      )}
      {!settings && status !== 'loadError' && (
        <p className="text-sm text-gray-500" role="status">{t.common.loading}</p>
      )}

      {settings && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {NOTIFICATION_CATEGORIES.map((category) => {
            const id = `notif-setting-${category}`;
            return (
              <li key={category} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <label htmlFor={id} className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {texts.categories[category]}
                  </label>
                  <p id={`${id}-desc`} className="text-xs text-gray-600 dark:text-gray-400">
                    {texts.categoryDescriptions[category]}
                  </p>
                </div>
                <button
                  id={id}
                  type="button"
                  role="switch"
                  aria-checked={settings[category]}
                  aria-describedby={`${id}-desc`}
                  disabled={saving === category}
                  onClick={() => void toggle(category)}
                  data-testid={`notification-setting-${category}`}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
                    settings[category] ? 'bg-[var(--fanous-color-accent)]' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      settings[category] ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 min-h-[1.25rem] text-sm" role="status" aria-live="polite">
        {status === 'saved' && <span className="text-green-700 dark:text-green-400">{texts.settingsSaved}</span>}
        {status === 'error' && <span className="text-red-600">{texts.settingsError}</span>}
      </p>
    </section>
  );
}

export default NotificationSettingsPanel;
