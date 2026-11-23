'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/AppLink';
import { formatDate as formatSharedDate, formatMoney, formatPercent, SOCIAL_NETWORKS, X_LINK_POST_COST_MICROS, X_MONTHLY_CAP_MAX_USD, X_POST_COST_MICROS, type SocialNetwork, type SocialPlatformSettings } from '@al-ummah/shared-types';
import { clearSocialCredentials, saveSocialCredentials, saveSocialSettings, type SocialAdminView, type SocialHistoryEntry } from '@/lib/api/admin';
import { useConfirm } from '@/components/content/actions';
import { ErrorAlert, cardClass, fieldClass, linkClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, translateDynamic, type MessageKey } from '@/i18n/translate';
import { logger } from '@/lib/logger-client';
import { NumberField } from '@/components/forms/NumberField';
import { FeatureStatusLine } from '@/components/features/FeatureStatusLine';
import type { FeatureStates } from '@/lib/features/states';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
const STATUSES = ['sent', 'queued', 'sending', 'failed', 'blocked', 'cancelled'] as const;
const ACCOUNT_STATUSES = ['active', 'needs_reconnect', 'revoked', 'suspended'] as const;

function usd(value: number, locale: string): string {
  return formatMoney(locale, value, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Admin → Social posting: kill switches, the X cap, network setup, activity, failures and the change history. */
export function SocialPostingView({ view, history, canEdit, features = {} }: { view: SocialAdminView; history: SocialHistoryEntry[]; canEdit: boolean; features?: FeatureStates }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [settings, setSettings] = useState<SocialPlatformSettings>(view.settings);
  const [cap, setCap] = useState(String(view.settings.xMonthlyCapUsd));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [xValues, setXValues] = useState({ clientId: '', clientSecret: '' });
  const [botToken, setBotToken] = useState('');
  const { confirm, dialog } = useConfirm();
  const net = (n: string) => (SOCIAL_NETWORKS as readonly string[]).includes(n) ? t(`socialPosting.networks.${n}` as MessageKey) : n;
  const capNumber = Number(cap);
  const capValid = cap.trim() !== '' && Number.isFinite(capNumber) && capNumber >= 0 && capNumber <= X_MONTHLY_CAP_MAX_USD;
  const dirty = JSON.stringify({ ...settings, xMonthlyCapUsd: capValid ? Math.round(capNumber * 100) / 100 : settings.xMonthlyCapUsd }) !== JSON.stringify(view.settings);
  const tokenKeyMissing = Object.values(view.readiness).some((r) => r.missing === 'token_key');

  const done = (text: string) => {
    setNotice(text);
    router.refresh();
  };

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit || !capValid) return;
    setBusy('settings');
    setError(null);
    setNotice(null);
    try {
      const result = await saveSocialSettings({ ...settings, xMonthlyCapUsd: Math.round(capNumber * 100) / 100 });
      if (!result.ok) {
        logger.warn('[social] Settings save failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('socialPosting.saveFailed'));
        return;
      }
      done(t('socialPosting.saved'));
    } catch (e) {
      logger.error('[social] Settings save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('socialPosting.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function saveCredentials(network: 'x' | 'telegram', event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setBusy(network);
    setError(null);
    setNotice(null);
    try {
      const result = await saveSocialCredentials(network, network === 'x' ? xValues : { botToken });
      if (!result.ok) {
        logger.warn('[social] Credentials save failed', { network, status: result.status });
        setError(result.status === 400 || result.status === 422 ? t('socialPosting.invalidCredentials') : t('socialPosting.credentialsFailed'));
        return;
      }
      if (network === 'x') setXValues({ clientId: '', clientSecret: '' });
      else setBotToken('');
      done(t('socialPosting.credentialsSaved'));
    } catch (e) {
      logger.error('[social] Credentials save request failed', { network, error: e instanceof Error ? e.message : String(e) });
      setError(t('socialPosting.credentialsFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function clearCredentials(network: 'x' | 'telegram') {
    const name = net(network);
    const ok = await confirm({
      title: t('socialPosting.confirmClearTitle', { network: name }),
      body: t('socialPosting.confirmClearBody', { network: name }),
      confirmLabel: t('socialPosting.clearCredentials'),
      danger: true,
      testId: `social-clear-${network}`,
    });
    if (!ok) return;
    setBusy(network);
    setError(null);
    setNotice(null);
    const result = await clearSocialCredentials(network);
    setBusy(null);
    if (!result.ok) {
      logger.warn('[social] Credentials clear failed', { network, status: result.status });
      setError(t('socialPosting.credentialsFailed'));
      return;
    }
    done(t('socialPosting.credentialsCleared'));
  }

  const statusPill = (configured: boolean) => (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${configured ? 'border-border text-fg' : 'border-current text-fg-muted'}`}>
      {configured ? t('socialPosting.configured') : t('socialPosting.notConfigured')}
    </span>
  );
  const checkbox = 'h-5 w-5 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const th = 'px-3 py-2 text-start font-medium text-fg-muted';
  const td = 'px-3 py-2 text-fg';

  type Failure = SocialAdminView['recentFailures'][number];
  const failureChannel = (f: Failure) =>
    f.channel_name ? (
      <Link href={`/channels/${encodeURIComponent(f.channel_id)}`} className={`${linkClass} break-words`} dir="auto" data-testid="social-failure-channel">
        {f.channel_name_localized?.[locale] || f.channel_name}
      </Link>
    ) : (
      <span className="text-fg-muted">{t('socialPosting.channelGone')}</span>
    );
  const failureError = (f: Failure) => (
    <>
      <p className="break-words" data-testid="social-failure-reason">{translateDynamic(t, 'socialPosting.reasons', f.reason)}</p>
      {f.last_error ? (
        <details className="mt-1 text-xs text-fg-muted">
          <summary className="cursor-pointer select-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">{t('socialPosting.showDetails')}</summary>
          <code className="mt-1 block break-words text-start font-mono" dir="ltr">{f.last_error}</code>
        </details>
      ) : null}
    </>
  );

  const historyText = (h: SocialHistoryEntry) => {
    const sentence = h.key === 'social:settings'
      ? t('socialPosting.historySettings')
      : t('socialPosting.historyCredentials', {
          network: net(h.key.split(':')[2] ?? ''),
          action: h.newValue.includes('cleared') ? t('socialPosting.actionCleared') : t('socialPosting.actionSet'),
        });
    // The name is kept on one line (nowrap): the line wraps before a person's name, never inside it
    return (
      <>
        {fillNodes(sentence, {
          date: <LocalTime value={h.createdAt} withTime />,
          actor: <span className="whitespace-nowrap" data-testid="social-history-actor">{h.actorName || t('socialPosting.someAdmin')}</span>,
        })}
      </>
    );
  };

  return (
    <div className="space-y-6" data-testid="social-posting">
      {dialog}
      {tokenKeyMissing ? <ErrorAlert testId="social-token-key-missing">{t('socialPosting.tokenKeyMissing')}</ErrorAlert> : null}
      {error ? <ErrorAlert testId="social-posting-save-error">{error}</ErrorAlert> : null}
      <p role="status" className="text-sm text-fg" data-testid="social-posting-saved">{notice}</p>

      <section className={cardClass} aria-labelledby={`${ids}-switches`}>
        <h2 id={`${ids}-switches`} className="text-lg font-semibold text-fg mb-4">{t('socialPosting.switchesTitle')}</h2>
        <form onSubmit={saveSettings} className="space-y-5" noValidate>
          <fieldset disabled={!canEdit || busy === 'settings'} className="space-y-4">
            <FeatureStatusLine featureKey="socialAutopost" item={features.socialAutopost} />
            <div className="grid gap-2 sm:grid-cols-2">
              {SOCIAL_NETWORKS.map((n) => (
                <label key={n} className="flex min-h-11 items-center gap-3 rounded border border-border px-3">
                  <input
                    type="checkbox"
                    className={checkbox}
                    checked={settings.networks[n].enabled}
                    onChange={(e) => setSettings((s) => ({ ...s, networks: { ...s.networks, [n]: { enabled: e.target.checked } } }))}
                    data-testid={`social-network-${n}`}
                  />
                  <span className="text-fg">{t('socialPosting.networkEnabled', { network: net(n) })}</span>
                  <span className="ms-auto">{statusPill(view.readiness[n as SocialNetwork].configured)}</span>
                </label>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-fg">{t('socialPosting.xCapTitle')}</h3>
              <label htmlFor={`${ids}-cap`} className="block text-sm font-medium text-fg">{t('socialPosting.xCap')}</label>
              <NumberField decimal
                id={`${ids}-cap`}
                autoComplete="off"
                dir="ltr"
                className={`${fieldClass} w-40`}
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                aria-invalid={!capValid}
                aria-describedby={`${ids}-cap-hint`}
                data-testid="social-x-cap"
              />
              <p id={`${ids}-cap-hint`} className="text-sm text-fg-muted">
                {t('socialPosting.xCapHint', { post: usd(X_POST_COST_MICROS / 1_000_000, locale), link: usd(X_LINK_POST_COST_MICROS / 1_000_000, locale), zero: 0, pause: formatPercent(locale, 0.9) })}
              </p>
              <p className="text-sm text-fg" data-testid="social-x-spend">
                {t('socialPosting.xSpend', {
                  month: formatSharedDate(locale, `${view.spend.month}-01T12:00:00Z`, { year: 'numeric', month: 'long', timeZone: 'UTC' }),
                  cost: usd(view.spend.x.costUsd, locale),
                  posts: formatNumber(view.spend.x.posts, locale),
                  cap: usd(view.spend.x.capUsd, locale),
                })}
              </p>
            </div>
          </fieldset>
          {canEdit ? (
            <button type="submit" className={primaryButtonClass} disabled={busy === 'settings' || !dirty || !capValid} data-testid="social-settings-save">
              {busy === 'settings' ? t('socialPosting.saving') : t('socialPosting.save')}
            </button>
          ) : (
            <p className="text-sm text-fg-muted" data-testid="social-read-only">{t('socialPosting.readOnly')}</p>
          )}
        </form>
      </section>

      <section className={cardClass} aria-labelledby={`${ids}-setup`}>
        <h2 id={`${ids}-setup`} className="text-lg font-semibold text-fg mb-4">{t('socialPosting.credentialsTitle')}</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={(e) => void saveCredentials('x', e)} className="space-y-3" noValidate data-testid="social-x-app">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-fg">{t('socialPosting.xApp')}</h3>
              {statusPill(view.readiness.x.configured)}
            </div>
            <p className="text-sm text-fg-muted">{t('socialPosting.xAppHint', { oauth: 'OAuth 2.0' })}</p>
            <div>
              <p className="text-sm font-medium text-fg">{t('socialPosting.callback')}</p>
              <code dir="ltr" className="block break-all rounded border border-border bg-surface-2 px-3 py-2 text-xs text-fg" data-testid="social-x-callback">{view.callbacks.x}</code>
            </div>
            {canEdit ? (
              <fieldset disabled={busy === 'x' || tokenKeyMissing} className="space-y-3">
                <div>
                  <label htmlFor={`${ids}-xid`} className="block text-sm font-medium text-fg">{t('socialPosting.clientId')}</label>
                  <input id={`${ids}-xid`} dir="ltr" autoComplete="off" className={`${fieldClass} w-full`} value={xValues.clientId} onChange={(e) => setXValues((v) => ({ ...v, clientId: e.target.value }))} data-testid="social-x-client-id" />
                </div>
                <div>
                  <label htmlFor={`${ids}-xsecret`} className="block text-sm font-medium text-fg">{t('socialPosting.clientSecret')}</label>
                  <input id={`${ids}-xsecret`} type="password" dir="ltr" autoComplete="new-password" className={`${fieldClass} w-full`} value={xValues.clientSecret} onChange={(e) => setXValues((v) => ({ ...v, clientSecret: e.target.value }))} data-testid="social-x-client-secret" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={primaryButtonClass} disabled={!xValues.clientId.trim() || !xValues.clientSecret.trim()} data-testid="social-x-save">{t('socialPosting.saveCredentials')}</button>
                  {view.readiness.x.configured ? (
                    <button type="button" className={secondaryButtonClass} onClick={() => void clearCredentials('x')} data-testid="social-x-clear">{t('socialPosting.clearCredentials')}</button>
                  ) : null}
                </div>
              </fieldset>
            ) : null}
          </form>

          <form onSubmit={(e) => void saveCredentials('telegram', e)} className="space-y-3" noValidate data-testid="social-telegram-bot">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-fg">{t('socialPosting.telegramBot')}</h3>
              {statusPill(view.readiness.telegram.configured)}
            </div>
            <p className="text-sm text-fg-muted">{t('socialPosting.telegramBotHint')}</p>
            {view.telegramBot ? (
              <p className="text-sm text-fg" dir="auto">
                <a className={linkClass} href={`https://t.me/${encodeURIComponent(view.telegramBot)}`} target="_blank" rel="noopener noreferrer">{t('socialPosting.botName', { name: view.telegramBot })}</a>
              </p>
            ) : null}
            {canEdit ? (
              <fieldset disabled={busy === 'telegram' || tokenKeyMissing} className="space-y-3">
                <div>
                  <label htmlFor={`${ids}-bot`} className="block text-sm font-medium text-fg">{t('socialPosting.botToken')}</label>
                  <input id={`${ids}-bot`} type="password" dir="ltr" autoComplete="new-password" className={`${fieldClass} w-full`} value={botToken} onChange={(e) => setBotToken(e.target.value)} data-testid="social-telegram-token" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={primaryButtonClass} disabled={!botToken.trim()} data-testid="social-telegram-save">{t('socialPosting.saveCredentials')}</button>
                  {view.readiness.telegram.configured ? (
                    <button type="button" className={secondaryButtonClass} onClick={() => void clearCredentials('telegram')} data-testid="social-telegram-clear">{t('socialPosting.clearCredentials')}</button>
                  ) : null}
                </div>
              </fieldset>
            ) : null}
          </form>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass} aria-labelledby={`${ids}-activity`}>
          <h2 id={`${ids}-activity`} className="text-lg font-semibold text-fg mb-4">{t('socialPosting.activityTitle', { days: 7 })}</h2>
          {view.deliveries7d.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('socialPosting.activityNone', { days: 7 })}</p>
          ) : (
            <div className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-labelledby={`${ids}-activity`}>
              <table className="w-full text-sm" data-testid="social-activity">
                <thead><tr><th className={th}>{t('socialPosting.colNetwork')}</th><th className={th}>{t('socialPosting.colStatus')}</th><th className={th}>{t('socialPosting.colCount')}</th></tr></thead>
                <tbody>
                  {view.deliveries7d.map((r) => (
                    <tr key={`${r.network}-${r.status}`} className="border-t border-border">
                      <td className={td}>{net(r.network)}</td>
                      <td className={td}>{(STATUSES as readonly string[]).includes(r.status) ? t(`socialPosting.statuses.${r.status}` as MessageKey) : r.status}</td>
                      <td className={td}>{formatNumber(r.n, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={cardClass} aria-labelledby={`${ids}-accounts`}>
          <h2 id={`${ids}-accounts`} className="text-lg font-semibold text-fg mb-4">{t('socialPosting.accountsTitle')}</h2>
          {view.accounts.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('socialPosting.accountsNone')}</p>
          ) : (
            <div className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-labelledby={`${ids}-accounts`}>
              <table className="w-full text-sm" data-testid="social-accounts">
                <thead><tr><th className={th}>{t('socialPosting.colNetwork')}</th><th className={th}>{t('socialPosting.colStatus')}</th><th className={th}>{t('socialPosting.colCount')}</th></tr></thead>
                <tbody>
                  {view.accounts.map((r) => (
                    <tr key={`${r.network}-${r.status}`} className="border-t border-border">
                      <td className={td}>{net(r.network)}</td>
                      <td className={td}>{(ACCOUNT_STATUSES as readonly string[]).includes(r.status) ? t(`socialPosting.accountStatuses.${r.status}` as MessageKey) : r.status}</td>
                      <td className={td}>{formatNumber(r.n, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className={cardClass} aria-labelledby={`${ids}-failures`}>
        <h2 id={`${ids}-failures`} className="text-lg font-semibold text-fg mb-1">{t('socialPosting.failuresTitle')}</h2>
        <p className="text-sm text-fg-muted mb-4">
          <Link className={linkClass} href="/errors">{t('socialPosting.failuresHint')}</Link>
        </p>
        {view.recentFailures.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('socialPosting.failuresNone')}</p>
        ) : (
          <>
            {/* Phone: one card per failure (a five-column table can't fit); wider screens: the table */}
            <ul className="space-y-3 md:hidden" data-testid="social-failures-cards">
              {view.recentFailures.map((f) => (
                <li key={f.id} className="rounded border border-border p-3 text-sm">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-fg-muted">
                    <span>{net(f.network)}</span>
                    <span><LocalTime value={f.updated_at} withTime /></span>
                  </p>
                  <p className="mt-1 break-words text-start font-medium text-fg"><bdi>{f.entity_title || f.entity_id}</bdi></p>
                  <p className="mt-1">{failureChannel(f)}</p>
                  <div className="mt-2">{failureError(f)}</div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus md:block" tabIndex={0} role="region" aria-labelledby={`${ids}-failures`}>
              <table className="w-full text-sm" data-testid="social-failures">
                <thead>
                  <tr><th className={th}>{t('socialPosting.colNetwork')}</th><th className={th}>{t('socialPosting.colItem')}</th><th className={th}>{t('socialPosting.colChannel')}</th><th className={th}>{t('socialPosting.colError')}</th><th className={th}>{t('socialPosting.colWhen')}</th></tr>
                </thead>
                <tbody>
                  {view.recentFailures.map((f) => (
                    <tr key={f.id} className="border-t border-border align-top">
                      <td className={td}>{net(f.network)}</td>
                      <td className={td} dir="auto">{f.entity_title || f.entity_id}</td>
                      <td className={td}>{failureChannel(f)}</td>
                      <td className={`${td} break-words`}>{failureError(f)}</td>
                      <td className={`${td} whitespace-nowrap`}><LocalTime value={f.updated_at} withTime /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={cardClass} aria-labelledby={`${ids}-history`}>
        <h2 id={`${ids}-history`} className="text-lg font-semibold text-fg mb-2">{t('socialPosting.historyTitle')}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('socialPosting.historyEmpty')}</p>
        ) : (
          <ul className="space-y-1 text-sm text-fg-muted" data-testid="social-history">
            {history.map((h) => <li key={h.id}>{historyText(h)}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
