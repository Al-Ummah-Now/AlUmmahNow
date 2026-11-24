'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_DOWNLOAD_RATE_LIMIT,
  DOWNLOAD_RATE_LIMIT_BOUNDS,
  localizeDigits,
  parseDigits,
  validateDownloadRateLimit,
  type DownloadRateLimitSettings,
} from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { LocalTime } from '@/components/LocalTime';

interface HistoryEntry {
  id: string;
  oldValue: string | null;
  newValue: string;
  actorId: string;
  createdAt: string;
}

function parseHistoryValue(raw: string | null): { perDay: number; burstPerMinute: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { perDay?: unknown; burstPerMinute?: unknown };
    if (typeof parsed.perDay === 'number' && typeof parsed.burstPerMinute === 'number') {
      return { perDay: parsed.perDay, burstPerMinute: parsed.burstPerMinute };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Per-user download request rate limit (E14-D2): configurable daily and burst caps
 * on `POST /api/v1/videos/:id/downloads`. Same rights for every signed-in viewer.
 */
export function DownloadRateLimitSetting({
  settings,
  history,
  canEdit,
  save: saveSettings,
}: {
  settings: DownloadRateLimitSettings;
  history: HistoryEntry[];
  canEdit: boolean;
  save: (input: { perDay: number; burstPerMinute: number }) => Promise<ActionResult<DownloadRateLimitSettings>>;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [perDayText, setPerDayText] = useState(localizeDigits(locale, settings.perDay));
  const [burstText, setBurstText] = useState(localizeDigits(locale, settings.burstPerMinute));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const n = (value: number) => formatNumber(value, locale);

  const parsedPerDay = Number(parseDigits(perDayText.trim()));
  const parsedBurst = Number(parseDigits(burstText.trim()));
  const validation = validateDownloadRateLimit({
    perDay: perDayText.trim() === '' ? Number.NaN : parsedPerDay,
    burstPerMinute: burstText.trim() === '' ? Number.NaN : parsedBurst,
  });
  const unchanged = validation.ok && validation.value.perDay === settings.perDay && validation.value.burstPerMinute === settings.burstPerMinute;

  const formatEntry = (raw: string | null) => {
    const v = parseHistoryValue(raw);
    if (!v) return raw ?? '—';
    return t('platformSettings.downloadRateLimitSummary', {
      perDay: n(v.perDay),
      burst: n(v.burstPerMinute),
    });
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    if (!validation.ok) {
      if (validation.error.reason === 'exceeds_per_day') {
        setError(t('platformSettings.downloadRateLimitBurstExceedsDay'));
      } else {
        setError(
          t('platformSettings.downloadRateLimitRangeError', {
            min: n(validation.error.min),
            max: n(validation.error.max),
          }),
        );
      }
      return;
    }
    if (unchanged) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveSettings(validation.value);
      if (!result.ok) {
        logger.warn('[platform-settings] Download rate limit save failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('platformSettings.downloadRateLimitSaveFailed'));
        return;
      }
      setNotice(t('platformSettings.downloadRateLimitSaved'));
      router.refresh();
    } catch (e) {
      logger.error('[platform-settings] Download rate limit save request failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(t('platformSettings.downloadRateLimitSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`${cardClass} mb-6`}
      aria-labelledby={`${ids}-title`}
      data-testid="download-rate-limit-setting"
      data-per-day={settings.perDay}
      data-burst={settings.burstPerMinute}
    >
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-1">
        {t('platformSettings.downloadRateLimitTitle')}
      </h2>
      <p className="text-sm text-fg-muted mb-4">{t('platformSettings.downloadRateLimitSubtitle')}</p>

      <form onSubmit={save} className="space-y-4" noValidate>
        <fieldset disabled={!canEdit || busy} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            <span className="text-fg font-medium">{t('platformSettings.downloadRateLimitPerDay')}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={perDayText}
              onChange={(e) => {
                setPerDayText(e.target.value);
                setError(null);
                setNotice(null);
              }}
              aria-describedby={`${ids}-perDay-help`}
              className={`${fieldClass} rtl:text-right`}
              dir="ltr"
              data-testid="download-rate-limit-per-day"
            />
            <span id={`${ids}-perDay-help`} className="text-xs">
              {t('platformSettings.downloadRateLimitPerDayHint', {
                min: n(DOWNLOAD_RATE_LIMIT_BOUNDS.perDay.min),
                max: n(DOWNLOAD_RATE_LIMIT_BOUNDS.perDay.max),
                defaultValue: n(DEFAULT_DOWNLOAD_RATE_LIMIT.perDay),
              })}
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            <span className="text-fg font-medium">{t('platformSettings.downloadRateLimitBurst')}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={burstText}
              onChange={(e) => {
                setBurstText(e.target.value);
                setError(null);
                setNotice(null);
              }}
              aria-describedby={`${ids}-burst-help`}
              className={`${fieldClass} rtl:text-right`}
              dir="ltr"
              data-testid="download-rate-limit-burst"
            />
            <span id={`${ids}-burst-help`} className="text-xs">
              {t('platformSettings.downloadRateLimitBurstHint', {
                min: n(DOWNLOAD_RATE_LIMIT_BOUNDS.burstPerMinute.min),
                max: n(DOWNLOAD_RATE_LIMIT_BOUNDS.burstPerMinute.max),
                defaultValue: n(DEFAULT_DOWNLOAD_RATE_LIMIT.burstPerMinute),
              })}
            </span>
          </label>
        </fieldset>

        <p className="text-sm text-fg-muted" data-testid="download-rate-limit-last-changed">
          {settings.updatedAt
            ? fillNodes(t('platformSettings.lastChanged'), {
                date: <LocalTime value={settings.updatedAt} withTime />,
                actor: settings.updatedBy ? <UserName id={settings.updatedBy} showEmail={false} /> : '—',
              })
            : t('platformSettings.neverChanged')}
        </p>

        {canEdit ? (
          <button
            type="submit"
            className={primaryButtonClass}
            disabled={busy || unchanged}
            data-testid="download-rate-limit-save"
          >
            {busy ? t('platformSettings.saving') : t('platformSettings.save')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="download-rate-limit-read-only">
            {t('platformSettings.readOnly')}
          </p>
        )}
        {error && <ErrorAlert testId="download-rate-limit-save-error">{error}</ErrorAlert>}
        <p role="status" className="text-sm text-fg" data-testid="download-rate-limit-saved">
          {notice}
        </p>
      </form>

      <h3 className="text-sm font-semibold text-fg mt-6 mb-2">{t('platformSettings.historyTitle')}</h3>
      {history.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('platformSettings.historyEmpty')}</p>
      ) : (
        <ul className="space-y-1 text-sm text-fg-muted" data-testid="download-rate-limit-history">
          {history.map((h) => (
            <li key={h.id}>
              {fillNodes(
                t('platformSettings.historyEntry', { from: formatEntry(h.oldValue), to: formatEntry(h.newValue) }),
                {
                  date: <LocalTime value={h.createdAt} withTime />,
                  actor: <UserName id={h.actorId} showEmail={false} />,
                },
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
