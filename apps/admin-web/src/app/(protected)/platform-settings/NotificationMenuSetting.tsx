'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationMenuOpenMode, NotificationPlatformSettings } from '@al-ummah/shared-types';
import { DEFAULT_NOTIFICATION_MENU_OPEN } from '@al-ummah/shared-types';
import { saveNotificationPlatformSettings } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';

import { LocalTime } from '@/components/LocalTime';
import { HelpTip } from '@/components/help/HelpTip';
const MODES: { value: NotificationMenuOpenMode; label: MessageKey; hint: MessageKey }[] = [
  { value: 'seen', label: 'platformSettings.menuOpenSeen', hint: 'platformSettings.menuOpenSeenHint' },
  { value: 'read', label: 'platformSettings.menuOpenRead', hint: 'platformSettings.menuOpenReadHint' },
];

interface HistoryEntry {
  id: string;
  oldValue: string | null;
  newValue: string;
  actorId: string;
  createdAt: string;
}

/** "When the notification menu is opened": clear the badge only (default), or also mark the shown notifications read. */
export function NotificationMenuSetting({ settings, history, canEdit }: { settings: NotificationPlatformSettings; history: HistoryEntry[]; canEdit: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [mode, setMode] = useState<NotificationMenuOpenMode>(settings.menuOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const label = (value: string | null) => {
    const m = MODES.find((x) => x.value === value);
    return m ? t(m.label) : (value ?? '—');
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || mode === settings.menuOpen) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveNotificationPlatformSettings(mode);
      if (!result.ok) {
        logger.warn('[platform-settings] Save failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('platformSettings.saveFailed'));
        return;
      }
      setNotice(t('platformSettings.saved'));
      router.refresh();
    } catch (e) {
      logger.error('[platform-settings] Save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('platformSettings.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const radio = 'mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${ids}-title`} data-testid="notification-menu-setting" data-mode={settings.menuOpen}>
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-4">{t('platformSettings.notificationsTitle')}</h2>
      <form onSubmit={save} className="space-y-4" noValidate>
        <fieldset disabled={!canEdit || busy}>
          {/* The "?" sits in the first legend, which a disabled fieldset leaves enabled (read-only admins still read the help) */}
          <legend className="text-sm font-medium text-fg mb-2">
            {t('platformSettings.menuOpenLegend')}
            <HelpTip id="platform.notifications.menuOpen" />
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((m) => (
              <label key={m.value} className="flex items-start gap-2 rounded border border-border p-3 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-surface-2">
                <input
                  type="radio"
                  name="menuOpen"
                  data-help="platform.notifications.menuOpen"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                  className={radio}
                  aria-describedby={`${ids}-${m.value}-hint`}
                  data-testid={`notification-menu-open-${m.value}`}
                />
                <span>
                  <span className="block text-fg font-medium">
                    {t(m.label)}
                    {m.value === DEFAULT_NOTIFICATION_MENU_OPEN && <span className="ms-2 text-xs font-normal text-fg-muted">({t('platformSettings.menuOpenDefault')})</span>}
                  </span>
                  <span id={`${ids}-${m.value}-hint`} className="block text-sm text-fg-muted">{t(m.hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="text-sm text-fg-muted" data-testid="notification-menu-last-changed">
          {settings.updatedAt
            ? fillNodes(t('platformSettings.lastChanged'), { date: <LocalTime value={settings.updatedAt} withTime />, actor: settings.updatedBy ? <UserName id={settings.updatedBy} showEmail={false} /> : '—' })
            : t('platformSettings.neverChanged')}
        </p>

        {canEdit ? (
          <button type="submit" className={primaryButtonClass} disabled={busy || mode === settings.menuOpen} data-testid="notification-menu-save">
            {busy ? t('platformSettings.saving') : t('platformSettings.save')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="notification-menu-read-only">{t('platformSettings.readOnly')}</p>
        )}
        {error && <ErrorAlert testId="notification-menu-save-error">{error}</ErrorAlert>}
        <p role="status" className="text-sm text-fg" data-testid="notification-menu-saved">{notice}</p>
      </form>

      <h3 className="text-sm font-semibold text-fg mt-6 mb-2">{t('platformSettings.historyTitle')}</h3>
      {history.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('platformSettings.historyEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm text-fg-muted" data-testid="notification-menu-history">
          {history.map((h) => (
            <li key={h.id}>
              {fillNodes(t('platformSettings.historyEntry', { from: label(h.oldValue), to: label(h.newValue) }), { date: <LocalTime value={h.createdAt} withTime />, actor: <UserName id={h.actorId} showEmail={false} /> })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
