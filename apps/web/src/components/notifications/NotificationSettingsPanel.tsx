'use client';

import React, { useEffect, useId, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  NOTIFICATION_EMAIL_LOCALES,
  OPTIONAL_NOTIFICATION_CATEGORIES,
  type NotificationEmailLocale,
  type NotificationSettingsResult,
  type NotificationSettingsUpdateRequest,
  type OptionalNotificationCategory,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { NotificationsService } from '@/services/api/notifications';
import { logger } from '@/lib/logger-client';
import { Switch } from '@/components/common/Switch';

type Saving = OptionalNotificationCategory | 'emailAccount' | 'emailLocale' | null;

/**
 * Settings page section (Story 29.10): turn notification categories on/off,
 * and the account email ("Email me about my account" and its language).
 * Account notices (a moderator's warning) always arrive in-app, so they have
 * no switch. Each control saves immediately.
 */
export function NotificationSettingsPanel() {
  const { t, dir, lang } = useLanguage();
  const uid = `notif${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const texts = t.notificationCenter;
  const emailTexts = texts.emailSettings;
  const [state, setState] = useState<NotificationSettingsResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'loadError'>('idle');
  const [saving, setSaving] = useState<Saving>(null);

  useEffect(() => {
    let cancelled = false;
    void NotificationsService.settings().then((s) => {
      if (cancelled) return;
      if (s) setState(s);
      else setStatus('loadError');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Shows the change at once, saves it, and puts the previous state back if the save fails. */
  const save = async (what: Exclude<Saving, null>, optimistic: NotificationSettingsResult, changes: NotificationSettingsUpdateRequest) => {
    if (!state) return;
    const previous = state;
    setState(optimistic);
    setSaving(what);
    const saved = await NotificationsService.updateSettings(changes);
    setSaving(null);
    if (saved) {
      setState(saved);
      setStatus('saved');
    } else {
      logger.warn('[NotificationSettingsPanel] Save failed', { what });
      setState(previous);
      setStatus('error');
    }
  };

  const toggle = (category: OptionalNotificationCategory) => {
    if (!state) return;
    const next = !state.settings[category];
    void save(category, { ...state, settings: { ...state.settings, [category]: next } }, { settings: { [category]: next } });
  };

  const toggleAccountEmail = () => {
    if (!state) return;
    const account = !state.email.account;
    void save('emailAccount', { ...state, email: { ...state.email, account } }, { email: { account } });
  };

  const changeEmailLocale = (locale: NotificationEmailLocale) => {
    if (!state) return;
    void save('emailLocale', { ...state, email: { ...state.email, locale } }, { email: { locale } });
  };

  // Until the user picks one, show the language they are using here
  const shownLocale: NotificationEmailLocale = state?.email.locale ?? (lang === 'ar' ? 'ar' : 'en');

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
      {!state && status !== 'loadError' && (
        <p className="text-sm text-gray-500" role="status">{t.common.loading}</p>
      )}

      {state && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {OPTIONAL_NOTIFICATION_CATEGORIES.map((category, index) => {
            // Ids come from useId(), never from the category name: page CSS
            // matches substrings such as [id*=comments] (the watch page).
            const id = `${uid}-${index}`;
            return (
              <li key={category} className="sw-row py-3" data-testid={`notification-setting-row-${category}`}>
                <div>
                  <label htmlFor={id} className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                    {texts.categories[category]}
                  </label>
                  <p id={`${id}-desc`} className="text-xs text-gray-600 dark:text-gray-400">
                    {texts.categoryDescriptions[category]}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={state.settings[category]}
                  onCheckedChange={() => toggle(category)}
                  aria-describedby={`${id}-desc`}
                  disabled={saving === category}
                  data-testid={`notification-setting-${category}`}
                />
              </li>
            );
          })}
        </ul>
      )}

      {state && (
        <div className="mt-6 border-t border-[var(--fanous-color-divider)] pt-4" data-testid="notification-email-settings">
          <h3 id={`${uid}-email-heading`} className="text-base font-semibold text-[var(--fanous-color-text-primary)]">
            {emailTexts.title}
          </h3>
          <p className="text-sm text-[var(--fanous-color-text-secondary)]">{emailTexts.description}</p>
          <div className="sw-row py-3">
            <div>
              <label htmlFor={`${uid}-email-account`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                {emailTexts.account}
              </label>
              <p id={`${uid}-email-account-desc`} className="text-xs text-[var(--fanous-color-text-secondary)]">
                {emailTexts.accountDescription}
              </p>
            </div>
            <Switch
              id={`${uid}-email-account`}
              checked={state.email.account}
              onCheckedChange={toggleAccountEmail}
              aria-describedby={`${uid}-email-account-desc`}
              disabled={saving === 'emailAccount'}
              data-testid="notification-email-account"
            />
          </div>
          <div className="py-3">
            <label htmlFor={`${uid}-email-locale`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
              {emailTexts.language}
            </label>
            <p id={`${uid}-email-locale-desc`} className="text-xs text-[var(--fanous-color-text-secondary)]">
              {emailTexts.languageDescription}
            </p>
            <select
              id={`${uid}-email-locale`}
              value={shownLocale}
              onChange={(e) => changeEmailLocale(e.target.value as NotificationEmailLocale)}
              aria-describedby={`${uid}-email-locale-desc`}
              disabled={saving === 'emailLocale'}
              data-testid="notification-email-locale"
              className="mt-1 min-h-11 rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-2 text-sm text-[var(--fanous-color-text-primary)]"
            >
              {NOTIFICATION_EMAIL_LOCALES.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {emailTexts.languages[locale]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-[var(--fanous-color-text-muted)]">{emailTexts.alwaysInApp}</p>
        </div>
      )}

      <p className="mt-3 min-h-[1.25rem] text-sm" role="status" aria-live="polite">
        {status === 'saved' && <span className="text-green-700 dark:text-green-400">{texts.settingsSaved}</span>}
        {status === 'error' && <span className="text-red-600">{texts.settingsError}</span>}
      </p>
    </section>
  );
}

export default NotificationSettingsPanel;
