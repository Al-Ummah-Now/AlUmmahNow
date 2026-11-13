'use client';

/**
 * Admin → Scholar sites → a site → Own domains (wiki AUN-SCHOLAR-SITES §4.2, #1212): the same
 * actions channel owners have in Studio → Site → Domains (add, check now, main address, remove),
 * for staff with creators:manage. Removing asks in the in-app dialog. While Cloudflare for SaaS is
 * not enabled on alummahnow.org, it says so instead of an error.
 */
import { useCallback, useEffect, useState, useTransition } from 'react';
import type { SiteDomainStatus } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { TierChangeDialog } from '@/components/creators/TierChangeDialog';
import { Chip, Notice, smallButtonClass } from '@/components/content/parts';
import { fieldClass } from '@/components/ui';
import { addSiteDomain, getSiteDomains, refreshSiteDomain, removeSiteDomain, setSitePrimaryHost, type SiteDomainsView } from '@/lib/api/sites';

const STATUS: Record<SiteDomainStatus, { key: MessageKey; tone: 'good' | 'info' | 'warn' | 'bad' }> = {
  waiting_dns: { key: 'scholarSites.domainStatusWaiting', tone: 'info' },
  issuing: { key: 'scholarSites.domainStatusIssuing', tone: 'info' },
  live: { key: 'scholarSites.domainStatusLive', tone: 'good' },
  failed: { key: 'scholarSites.domainStatusFailed', tone: 'bad' },
};

export function SiteDomainsPanel({ channelId, canManage }: { channelId: string; canManage: boolean }) {
  const { t } = useLanguage();
  const [view, setView] = useState<SiteDomainsView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [host, setHost] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const r = await getSiteDomains(channelId);
    if (r.ok) setView(r.data);
    else if (r.code === 'saas_unavailable') setUnavailable(true);
    else setMessage({ tone: 'bad', text: r.error });
  }, [channelId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string; code?: string }>) =>
    start(async () => {
      const r = await fn();
      setRemoving(null);
      if (!r.ok) {
        if (r.code === 'saas_unavailable') setUnavailable(true);
        else setMessage({ tone: 'bad', text: r.code ? `${r.code}${r.error && r.error !== r.code ? ` (${r.error})` : ''}` : r.error });
        return;
      }
      setMessage(null);
      setHost('');
      await load();
    });

  return (
    <section aria-labelledby={`site-domains-${channelId}`} className="space-y-2" data-testid="admin-site-domains">
      <h3 id={`site-domains-${channelId}`} className="text-sm font-medium">{t('scholarSites.domainsTitle')}</h3>
      {unavailable ? (
        <Notice tone="info" testId="admin-site-domains-unavailable">{t('scholarSites.domainsUnavailable')}</Notice>
      ) : !view ? null : (
        <>
          <p className="text-xs text-fg-muted">{t('scholarSites.domainsLimit', { n: view.limit })}</p>
          {view.domains.length === 0 && <p className="text-sm text-fg-muted">{t('scholarSites.domainsNone')}</p>}
          <ul className="space-y-3">
            {view.domains.map((d) => (
              <li key={d.host} className="space-y-1" data-testid="admin-site-domain" data-status={d.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="font-mono text-sm">{d.host}</span>
                  <Chip tone={STATUS[d.status].tone}>{t(STATUS[d.status].key)}</Chip>
                  {view.primaryHost === d.host && <Chip tone="good">{t('scholarSites.domainPrimary')}</Chip>}
                  {d.error && <span className="text-xs text-fg-muted" dir="ltr">{d.error}</span>}
                </div>
                {d.status !== 'live' && d.records.length > 0 && (
                  <details>
                    <summary className="text-xs cursor-pointer">{t('scholarSites.domainRecords')}</summary>
                    <ul className="text-xs font-mono space-y-0.5" dir="ltr">
                      {d.records.map((r, i) => (
                        <li key={i}>{r.type} {r.name} → {r.value}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {d.status !== 'live' && (
                      <button type="button" className={smallButtonClass} disabled={pending} onClick={() => run(() => refreshSiteDomain(channelId, d.host))}>
                        {t('scholarSites.domainCheck')}
                      </button>
                    )}
                    {d.status === 'live' && view.primaryHost !== d.host && (
                      <button type="button" className={smallButtonClass} disabled={pending} onClick={() => run(() => setSitePrimaryHost(channelId, d.host))}>
                        {t('scholarSites.domainMakePrimary')}
                      </button>
                    )}
                    <button type="button" className={smallButtonClass} disabled={pending} data-testid="admin-site-domain-remove" onClick={() => setRemoving(d.host)}>
                      {t('scholarSites.domainRemove')}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage && view.domains.length < view.limit && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (host.trim()) run(() => addSiteDomain(channelId, host.trim()));
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('scholarSites.domainLabel')}</span>
                <input className={fieldClass} dir="ltr" value={host} placeholder="www.example.com" data-testid="admin-site-domain-host" onChange={(e) => setHost(e.target.value)} />
              </label>
              <button type="submit" className={smallButtonClass} disabled={pending || !host.trim()} data-testid="admin-site-domain-add">
                {t('scholarSites.domainAdd')}
              </button>
            </form>
          )}
        </>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <TierChangeDialog
        open={!!removing}
        title={t('scholarSites.domainRemoveTitle', { host: removing ?? '' })}
        body={t('scholarSites.domainRemoveBody')}
        confirmLabel={t('scholarSites.domainRemove')}
        danger
        testId="admin-site-domain-confirm"
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && run(() => removeSiteDomain(channelId, removing))}
      />
    </section>
  );
}
