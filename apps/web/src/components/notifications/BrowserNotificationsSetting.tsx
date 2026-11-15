'use client';

import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { Switch } from '@/components/common/Switch';
import { disableWebPush, enableWebPush, isIosOutsideHomeScreen, webPushState, type WebPushState } from '@/lib/push/web-push';

interface BrowserNotificationsSettingProps {
  userId: string;
  /** Prefix for element ids (the panel's useId-based one). */
  idPrefix: string;
}

/**
 * Notification settings: Web Push on this browser (#1287). Hidden while the environment has no
 * VAPID key pair. The switch asks for the browser's permission on the first turn-on.
 */
export function BrowserNotificationsSetting({ userId, idPrefix }: BrowserNotificationsSettingProps) {
  const { t, lang } = useLanguage();
  const texts = t.notificationCenter.browserSettings;
  const [state, setState] = useState<WebPushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'enable' | 'disable' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void webPushState(userId).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state === null || state === 'unavailable') return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    if (state === 'on') {
      const done = await disableWebPush();
      if (done) setState('off');
      else setError('disable');
    } else {
      const next = await enableWebPush(userId, lang);
      if (next === 'error') setError('enable');
      else setState(next);
    }
    setBusy(false);
  };

  const id = `${idPrefix}-browser`;
  const note =
    state === 'unsupported' ? (isIosOutsideHomeScreen() ? texts.iosHint : texts.unsupported) : state === 'denied' ? texts.denied : null;

  return (
    <div className="mt-6 border-t border-[var(--fanous-color-divider)] pt-4" data-testid="notification-browser-settings" data-state={state}>
      <h3 className="text-base font-semibold text-[var(--fanous-color-text-primary)]">{texts.title}</h3>
      <p className="text-sm text-[var(--fanous-color-text-secondary)]">{texts.description}</p>
      {state === 'unsupported' ? (
        <p className="py-3 text-sm text-[var(--fanous-color-text-secondary)]" data-testid="notification-browser-note">
          {note}
        </p>
      ) : (
        <div className="sw-row py-3">
          <div>
            <label htmlFor={id} className="block text-sm font-medium text-[var(--fanous-color-text-primary)]">
              {texts.toggle}
            </label>
            <p id={`${id}-desc`} className="text-xs text-[var(--fanous-color-text-secondary)]">
              {note ?? texts.toggleDescription}
            </p>
          </div>
          <Switch
            id={id}
            checked={state === 'on'}
            onCheckedChange={() => void toggle()}
            aria-describedby={`${id}-desc`}
            disabled={busy || state === 'denied'}
            data-testid="notification-browser-toggle"
          />
        </div>
      )}
      {error && (
        <p className="text-sm text-[var(--fanous-color-error-text)]" role="alert" data-testid="notification-browser-error">
          {error === 'enable' ? texts.enableError : texts.disableError}
        </p>
      )}
    </div>
  );
}

export default BrowserNotificationsSetting;
