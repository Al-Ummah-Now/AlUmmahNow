'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { Bell, Moon } from 'lucide-react';
import {
  DEFAULT_NOTIFICATION_QUIET_HOURS,
  NOTIFICATION_EMAIL_LOCALES,
  OPTIONAL_NOTIFICATION_CATEGORIES,
  type NotificationEmailLocale,
  type NotificationQuietHours,
  type NotificationQuietHoursUpdate,
  type NotificationSettingsResult,
  type NotificationSettingsUpdateRequest,
  type OptionalNotificationCategory,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { NotificationsService } from '@/services/api/notifications';
import { logger } from '@/lib/logger-client';
import { Switch } from '@/components/common/Switch';
import { useAuth } from '@/components/AuthProvider/authContext';
import {
  buildQuietMinuteOptions,
  buildQuietTimezoneOptions,
  detectBrowserTimeZone,
  formatMinuteOfDay,
  readLocalPrayerQuietWindows,
} from '@/lib/notifications/prayer-quiet-windows';
import { BrowserNotificationsSetting } from './BrowserNotificationsSetting';

type Saving =
  | OptionalNotificationCategory
  | 'emailAccount'
  | 'emailLocale'
  | 'quietEnabled'
  | 'quietStart'
  | 'quietEnd'
  | 'quietTimezone'
  | 'prayerQuiet'
  | null;

/**
 * Settings page section (Story 29.10 & Epic 22 E22-S5): turn notification categories on/off,
 * browser notifications on this device (Web Push, #1287), daily quiet hours & prayer-time quiet
 * windows (E22-D6), and the account email ("Email me about my account" and its language).
 * Account notices always arrive in-app and bypass quiet hours. Each control saves immediately.
 */
export function NotificationSettingsPanel() {
  const { t, dir, lang } = useLanguage();
  const { user } = useAuth();
  const uid = `notif${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const texts = t.notificationCenter;
  const emailTexts = texts.emailSettings;
  const quietTexts = texts.quietHours;
  const [state, setState] = useState<NotificationSettingsResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error' | 'loadError'>('idle');
  const [saving, setSaving] = useState<Saving>(null);
  const [detectedZone, setDetectedZone] = useState<string | null>(null);
  const [localPrayerCount, setLocalPrayerCount] = useState<number>(0);

  useEffect(() => {
    setDetectedZone(detectBrowserTimeZone());
    setLocalPrayerCount(readLocalPrayerQuietWindows().length);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void NotificationsService.settings().then((s) => {
      if (cancelled) return;
      if (s) {
        setState(s);
      } else {
        setStatus('loadError');
      }
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

  const updateQuiet = (what: Exclude<Saving, null>, patch: NotificationQuietHoursUpdate) => {
    if (!state?.quietHours) return;
    const current = state.quietHours;
    const nextQuiet: NotificationQuietHours = {
      ...current,
      ...patch,
      prayerWindows: patch.prayerWindows ?? current.prayerWindows,
    };
    void save(what, { ...state, quietHours: nextQuiet }, { quietHours: patch });
  };

  const toggleDailyQuiet = () => {
    if (!state?.quietHours) return;
    const current = state.quietHours;
    const enabled = !current.enabled;
    const autoZone = enabled && current.timezone === 'UTC' && detectedZone ? detectedZone : current.timezone;
    updateQuiet('quietEnabled', { enabled, timezone: autoZone });
  };

  const togglePrayerQuiet = () => {
    if (!state?.quietHours) return;
    const current = state.quietHours;
    const prayerQuietEnabled = !current.prayerQuietEnabled;
    const localWindows = readLocalPrayerQuietWindows();
    setLocalPrayerCount(localWindows.length);
    const autoZone = prayerQuietEnabled && current.timezone === 'UTC' && detectedZone ? detectedZone : current.timezone;
    updateQuiet('prayerQuiet', {
      prayerQuietEnabled,
      timezone: autoZone,
      ...(prayerQuietEnabled && localWindows.length > 0 ? { prayerWindows: localWindows } : {}),
    });
  };

  const quietHours = state?.quietHours ?? DEFAULT_NOTIFICATION_QUIET_HOURS;
  const minuteOptions = useMemo(
    () => buildQuietMinuteOptions([quietHours.startMinute, quietHours.endMinute]),
    [quietHours.startMinute, quietHours.endMinute],
  );
  const timezoneOptions = useMemo(
    () => buildQuietTimezoneOptions(quietHours.timezone, detectedZone),
    [quietHours.timezone, detectedZone],
  );

  // Until the user picks one, show the language they are using here
  const shownLocale: NotificationEmailLocale = state?.email.locale ?? (lang === 'ar' ? 'ar' : 'en');
  const selectClass =
    'mt-1 min-h-11 rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-2 text-sm text-[var(--fanous-color-text-primary)] disabled:opacity-60';

  return (
    <section
      id="notifications"
      dir={dir}
      aria-labelledby="notification-settings-heading"
      data-testid="notification-settings"
      className="mt-8 rounded-lg border border-[var(--fanous-color-divider)] bg-[var(--fanous-color-surface)] p-6"
    >
      <div className="mb-4 flex items-center gap-3">
        <Bell className="h-6 w-6 text-[var(--fanous-color-accent)]" aria-hidden="true" />
        <div>
          <h2 id="notification-settings-heading" className="text-lg font-semibold text-[var(--fanous-color-text-primary)]">
            {texts.settingsTitle}
          </h2>
          <p className="text-sm text-[var(--fanous-color-text-secondary)]">{texts.settingsDescription}</p>
        </div>
      </div>

      {status === 'loadError' && (
        <p className="text-sm text-[var(--fanous-color-error-text)]" role="alert">{texts.loadError}</p>
      )}
      {!state && status !== 'loadError' && (
        <p className="text-sm text-[var(--fanous-color-text-muted)]" role="status">{t.common.loading}</p>
      )}

      {state && (
        <ul className="divide-y divide-[var(--fanous-color-divider)]">
          {OPTIONAL_NOTIFICATION_CATEGORIES.map((category, index) => {
            // Ids come from useId(), never from the category name: page CSS
            // matches substrings such as [id*=comments] (the watch page).
            const id = `${uid}-${index}`;
            return (
              <li key={category} className="sw-row py-3" data-testid={`notification-setting-row-${category}`}>
                <div>
                  <label htmlFor={id} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                    {texts.categories[category]}
                  </label>
                  <p id={`${id}-desc`} className="text-xs text-[var(--fanous-color-text-secondary)]">
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

      {state && user?.id && <BrowserNotificationsSetting userId={user.id} idPrefix={uid} />}

      {state?.quietHours && (
        <div className="mt-6 border-t border-[var(--fanous-color-divider)] pt-4" data-testid="notification-quiet-hours">
          <div className="mb-2 flex items-center gap-2">
            <Moon className="h-5 w-5 text-[var(--fanous-color-accent)]" aria-hidden="true" />
            <h3 id={`${uid}-quiet-heading`} className="text-base font-semibold text-[var(--fanous-color-text-primary)]">
              {quietTexts.title}
            </h3>
          </div>
          <p className="text-sm text-[var(--fanous-color-text-secondary)]">{quietTexts.description}</p>

          <div className="sw-row py-3">
            <div>
              <label htmlFor={`${uid}-quiet-daily`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                {quietTexts.dailyToggle}
              </label>
              <p id={`${uid}-quiet-daily-desc`} className="text-xs text-[var(--fanous-color-text-secondary)]">
                {quietTexts.dailyDescription}
              </p>
            </div>
            <Switch
              id={`${uid}-quiet-daily`}
              checked={quietHours.enabled}
              onCheckedChange={toggleDailyQuiet}
              aria-describedby={`${uid}-quiet-daily-desc`}
              disabled={saving === 'quietEnabled'}
              data-testid="notification-quiet-enabled"
            />
          </div>

          <div className="grid gap-3 py-2 sm:grid-cols-3">
            <div>
              <label htmlFor={`${uid}-quiet-start`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                {quietTexts.startTime}
              </label>
              <select
                id={`${uid}-quiet-start`}
                value={quietHours.startMinute}
                onChange={(e) => updateQuiet('quietStart', { startMinute: Number(e.target.value) })}
                disabled={saving === 'quietStart'}
                data-testid="notification-quiet-start"
                className={`${selectClass} w-full`}
              >
                {minuteOptions.map((m) => (
                  <option key={m} value={m} disabled={m === quietHours.endMinute}>
                    {formatMinuteOfDay(lang, m)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${uid}-quiet-end`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                {quietTexts.endTime}
              </label>
              <select
                id={`${uid}-quiet-end`}
                value={quietHours.endMinute}
                onChange={(e) => updateQuiet('quietEnd', { endMinute: Number(e.target.value) })}
                disabled={saving === 'quietEnd'}
                data-testid="notification-quiet-end"
                className={`${selectClass} w-full`}
              >
                {minuteOptions.map((m) => (
                  <option key={m} value={m} disabled={m === quietHours.startMinute}>
                    {formatMinuteOfDay(lang, m)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${uid}-quiet-tz`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                {quietTexts.timezone}
              </label>
              <select
                id={`${uid}-quiet-tz`}
                value={quietHours.timezone}
                onChange={(e) => updateQuiet('quietTimezone', { timezone: e.target.value })}
                aria-describedby={`${uid}-quiet-tz-desc`}
                disabled={saving === 'quietTimezone'}
                dir="ltr"
                data-testid="notification-quiet-timezone"
                className={`${selectClass} w-full`}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p id={`${uid}-quiet-tz-desc`} className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]">
                {quietTexts.timezoneDescription}
              </p>
            </div>
          </div>

          {(localPrayerCount > 0 || quietHours.prayerQuietEnabled) && (
            <div className="sw-row py-3">
              <div>
                <label htmlFor={`${uid}-quiet-prayer`} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
                  {quietTexts.prayerToggle}
                </label>
                <p id={`${uid}-quiet-prayer-desc`} className="text-xs text-[var(--fanous-color-text-secondary)]">
                  {quietTexts.prayerDescription}
                </p>
              </div>
              <Switch
                id={`${uid}-quiet-prayer`}
                checked={quietHours.prayerQuietEnabled}
                onCheckedChange={togglePrayerQuiet}
                aria-describedby={`${uid}-quiet-prayer-desc`}
                disabled={saving === 'prayerQuiet'}
                data-testid="notification-prayer-quiet-enabled"
              />
            </div>
          )}

          <p className="text-xs text-[var(--fanous-color-text-muted)]">{quietTexts.alwaysAccountNote}</p>
        </div>
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
              className={selectClass}
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
        {status === 'saved' && <span className="text-[var(--fanous-color-success-text)]">{texts.settingsSaved}</span>}
        {status === 'error' && <span className="text-[var(--fanous-color-error-text)]">{texts.settingsError}</span>}
      </p>
    </section>
  );
}

export default NotificationSettingsPanel;
