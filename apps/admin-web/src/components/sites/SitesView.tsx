'use client';

/**
 * Admin → Scholar sites (wiki AUN-SCHOLAR-SITES §8). Grant form (channel autocomplete, tier,
 * subdomain with a live availability check, languages, limits), the sites list with search, and a
 * panel per site: status, rename, limits, revoke/restore and its history. Destructive and public
 * changes ask in the in-app dialog, never a browser prompt.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  SITE_TIER_SEEDS,
  suggestSiteSlug,
  validateSiteSlug,
  type AdminSuggestion,
  type SiteLimits,
  type SiteLocale,
  type SiteSettings,
  type SiteStatus,
  type SiteTier,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { Autocomplete } from '@/components/search/Autocomplete';
import { TierChangeDialog } from '@/components/creators/TierChangeDialog';
import { Chip, EmptyState, Notice, PageHeader, SectionCard, smallButtonClass, tableWrapClass, tdClass, thClass } from '@/components/content/parts';
import { fieldClass, primaryButtonClass } from '@/components/ui';
import { checkSiteSlug, getSite, grantSite, restoreSite, revokeSite, updateSite, type SiteDetail, type SiteListItem } from '@/lib/api/sites';

const STATUS_KEY: Record<SiteStatus, MessageKey> = {
  setup: 'scholarSites.statusSetup',
  live: 'scholarSites.statusLive',
  suspended: 'scholarSites.statusSuspended',
  revoked: 'scholarSites.statusRevoked',
};
const STATUS_TONE: Record<SiteStatus, 'good' | 'info' | 'warn' | 'bad'> = { setup: 'info', live: 'good', suspended: 'warn', revoked: 'bad' };
const TIER_KEY: Record<SiteTier, MessageKey> = { 'white-label': 'scholarSites.tierWhiteLabel', 'white-label-domain': 'scholarSites.tierWhiteLabelDomain' };

type SlugState = { state: 'idle' | 'checking' | 'free' | 'taken' | 'reserved' | 'invalid'; host?: string };

function useSlugCheck(slug: string, channelId: string): SlugState {
  const [result, setResult] = useState<SlugState>({ state: 'idle' });
  useEffect(() => {
    if (!slug) {
      setResult({ state: 'idle' });
      return;
    }
    const problem = validateSiteSlug(slug);
    if (problem) {
      setResult({ state: problem === 'reserved' ? 'reserved' : 'invalid' });
      return;
    }
    setResult({ state: 'checking' });
    let live = true;
    const timer = setTimeout(async () => {
      const r = await checkSiteSlug(slug, channelId || undefined);
      if (!live) return;
      if (!r.ok) setResult({ state: 'idle' });
      else setResult({ state: r.data.available ? 'free' : r.data.reason === 'reserved' ? 'reserved' : r.data.reason === 'taken' ? 'taken' : 'invalid', host: r.data.host });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, channelId]);
  return result;
}

function LimitsFields({ value, onChange, idPrefix }: { value: SiteLimits; onChange: (v: SiteLimits) => void; idPrefix: string }) {
  const { t } = useLanguage();
  const num = (key: 'customDomainsMax' | 'pagesMax' | 'navigationMax', label: MessageKey) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{t(label)}</span>
      <input type="number" min={0} max={key === 'navigationMax' ? 30 : 1000} className={fieldClass} value={value[key]} data-testid={`${idPrefix}-${key}`} onChange={(e) => onChange({ ...value, [key]: Math.max(0, Number(e.target.value) || 0) })} />
    </label>
  );
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="text-sm font-medium mb-2">{t('scholarSites.limits')}</legend>
      {num('customDomainsMax', 'scholarSites.customDomainsMax')}
      {num('pagesMax', 'scholarSites.pagesMax')}
      {num('navigationMax', 'scholarSites.navigationMax')}
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('scholarSites.platformMark')}</span>
        <select className={fieldClass} value={value.platformMark} data-testid={`${idPrefix}-platformMark`} onChange={(e) => onChange({ ...value, platformMark: e.target.value as SiteLimits['platformMark'] })}>
          <option value="required">{t('scholarSites.platformMarkRequired')}</option>
          <option value="minimal">{t('scholarSites.platformMarkMinimal')}</option>
          <option value="none">{t('scholarSites.platformMarkNone')}</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.analytics} onChange={(e) => onChange({ ...value, analytics: e.target.checked })} />
        {t('scholarSites.analytics')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.brandedSignIn} onChange={(e) => onChange({ ...value, brandedSignIn: e.target.checked })} />
        {t('scholarSites.brandedSignIn')}
      </label>
    </fieldset>
  );
}

function SlugHint({ check }: { check: SlugState }) {
  const { t } = useLanguage();
  const text =
    check.state === 'checking' ? t('scholarSites.slugChecking')
    : check.state === 'free' ? t('scholarSites.slugFree', { host: check.host ?? '' })
    : check.state === 'taken' ? t('scholarSites.slugTaken')
    : check.state === 'reserved' ? t('scholarSites.slugReserved')
    : check.state === 'invalid' ? t('scholarSites.slugInvalid')
    : t('scholarSites.slugHint');
  return (
    <span className={`text-xs ${check.state === 'taken' || check.state === 'reserved' || check.state === 'invalid' ? 'text-danger-fg' : 'text-fg-muted'}`} role="status" data-testid="site-slug-status" data-state={check.state}>
      {text}
    </span>
  );
}

function GrantForm({ onDone }: { onDone: (message: string) => void }) {
  const { t } = useLanguage();
  const [channel, setChannel] = useState<AdminSuggestion | null>(null);
  const [tier, setTier] = useState<SiteTier>('white-label');
  const [slug, setSlug] = useState('');
  const [locales, setLocales] = useState<SiteLocale[]>(['en', 'ar']);
  const [limits, setLimits] = useState<SiteLimits>(SITE_TIER_SEEDS['white-label'].limits);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const check = useSlugCheck(slug, channel?.id ?? '');

  return (
    <form
      className="space-y-4"
      data-testid="site-grant-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!channel || check.state !== 'free') return;
        setError(null);
        start(async () => {
          const r = await grantSite(channel.id, { tier, slug, limits, locales });
          if (!r.ok) setError(r.error);
          else {
            setSlug('');
            setChannel(null);
            onDone(t('scholarSites.granted'));
          }
        });
      }}
    >
      <Autocomplete
        kind="channel"
        mode="pick"
        label={t('scholarSites.channel')}
        hint={t('scholarSites.channelHint')}
        testId="site-grant-channel"
        onChange={(id, item) => {
          setChannel(id ? item : null);
          if (item && !slug) setSlug(suggestSiteSlug(item.secondary?.replace(/^@/, '') || item.label));
        }}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('scholarSites.tier')}</span>
          <select
            className={fieldClass}
            value={tier}
            data-testid="site-grant-tier"
            onChange={(e) => {
              const next = e.target.value as SiteTier;
              setTier(next);
              setLimits(SITE_TIER_SEEDS[next].limits);
            }}
          >
            <option value="white-label">{t('scholarSites.tierWhiteLabel')}</option>
            <option value="white-label-domain">{t('scholarSites.tierWhiteLabelDomain')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('scholarSites.slug')}</span>
          <input className={fieldClass} dir="ltr" value={slug} maxLength={40} data-testid="site-grant-slug" onChange={(e) => setSlug(e.target.value.toLowerCase().trim())} aria-describedby="site-slug-hint" />
          <span id="site-slug-hint"><SlugHint check={check} /></span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('scholarSites.languages')}</span>
          <select className={fieldClass} value={locales.join(',')} data-testid="site-grant-locales" onChange={(e) => setLocales(e.target.value.split(',') as SiteLocale[])}>
            <option value="en,ar">{t('scholarSites.languagesBoth')}</option>
            <option value="ar,en">{t('scholarSites.languagesBothArFirst')}</option>
            <option value="en">{t('scholarSites.languagesEn')}</option>
            <option value="ar">{t('scholarSites.languagesAr')}</option>
          </select>
        </label>
      </div>
      <LimitsFields value={limits} onChange={setLimits} idPrefix="site-grant" />
      {error && <Notice tone="bad" testId="site-grant-error">{error}</Notice>}
      <button type="submit" className={primaryButtonClass} disabled={pending || !channel || check.state !== 'free'} data-testid="site-grant-submit">
        {t('scholarSites.grant')}
      </button>
    </form>
  );
}

type Confirm = { title: string; body: string; label: string; danger: boolean; run: () => Promise<{ ok: boolean; error?: string }> } | null;

function SitePanel({ channelId, canManage, onChanged }: { channelId: string; canManage: boolean; onChanged: () => void }) {
  const { t, locale } = useLanguage();
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [limits, setLimits] = useState<SiteLimits | null>(null);
  const [rename, setRename] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'bad'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const check = useSlugCheck(rename, channelId);

  const load = useMemo(
    () => async () => {
      const r = await getSite(channelId);
      if (r.ok) {
        setDetail(r.data);
        setLimits(r.data.site?.limits ?? null);
      } else setMessage({ tone: 'bad', text: r.error });
    },
    [channelId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const site = detail?.site ?? null;
  if (!site) return message ? <Notice tone="bad">{message.text}</Notice> : <p className="text-fg-muted text-sm">{t('common.loading')}</p>;
  const host = site.hosts.find((h) => h.primary)?.host ?? site.hosts[0]?.host ?? '';

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setConfirm(null);
      setMessage(r.ok ? { tone: 'info', text: t('scholarSites.saved') } : { tone: 'bad', text: r.error ?? '' });
      if (r.ok) {
        setRename('');
        await load();
        onChanged();
      }
    });

  return (
    <div className="space-y-4" data-testid="site-panel" data-status={site.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={STATUS_TONE[site.status]} testId="site-panel-status">{t(STATUS_KEY[site.status])}</Chip>
        <span dir="ltr" className="font-mono text-sm">{host}</span>
        <span className="text-sm text-fg-muted">{t(TIER_KEY[site.tier])} · {t('scholarSites.theme')}: <span dir="ltr">{site.themeRef}</span></span>
        {site.status === 'live' && (
          <a className="text-sm underline" href={`https://${host}/`} target="_blank" rel="noopener noreferrer">{t('scholarSites.open')}</a>
        )}
      </div>
      {message && <Notice tone={message.tone} testId="site-panel-message">{message.text}</Notice>}
      {canManage ? (
        <>
          <div className="flex flex-wrap gap-2">
            {site.status === 'setup' && (
              <button type="button" className={smallButtonClass} data-testid="site-go-live" disabled={pending}
                onClick={() => setConfirm({ title: t('scholarSites.confirmLiveTitle'), body: t('scholarSites.confirmLiveBody', { host }), label: t('scholarSites.goLive'), danger: false, run: () => updateSite(channelId, { status: 'live' }) })}>
                {t('scholarSites.goLive')}
              </button>
            )}
            {site.status === 'live' && (
              <button type="button" className={smallButtonClass} data-testid="site-suspend" disabled={pending}
                onClick={() => setConfirm({ title: t('scholarSites.confirmSuspendTitle'), body: t('scholarSites.confirmSuspendBody'), label: t('scholarSites.suspend'), danger: true, run: () => updateSite(channelId, { status: 'suspended' }) })}>
                {t('scholarSites.suspend')}
              </button>
            )}
            {site.status === 'suspended' && (
              <button type="button" className={smallButtonClass} data-testid="site-unsuspend" disabled={pending} onClick={() => act(() => updateSite(channelId, { status: 'live' }))}>
                {t('scholarSites.unsuspend')}
              </button>
            )}
            {site.status === 'revoked' ? (
              <button type="button" className={smallButtonClass} data-testid="site-restore" disabled={pending} onClick={() => act(() => restoreSite(channelId))}>
                {t('scholarSites.restore')}
              </button>
            ) : (
              <button type="button" className={smallButtonClass} data-testid="site-revoke" disabled={pending}
                onClick={() => setConfirm({ title: t('scholarSites.confirmRevokeTitle'), body: t('scholarSites.confirmRevokeBody'), label: t('scholarSites.revoke'), danger: true, run: () => revokeSite(channelId) })}>
                {t('scholarSites.revoke')}
              </button>
            )}
          </div>
          {site.status !== 'revoked' && limits && (
            <>
              <LimitsFields value={limits} onChange={setLimits} idPrefix="site-edit" />
              <button type="button" className={smallButtonClass} data-testid="site-save-limits" disabled={pending} onClick={() => act(() => updateSite(channelId, { limits }))}>
                {t('scholarSites.saveLimits')}
              </button>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('scholarSites.rename')}</span>
                  <input className={fieldClass} dir="ltr" value={rename} placeholder={site.slug} maxLength={40} data-testid="site-rename-slug" onChange={(e) => setRename(e.target.value.toLowerCase().trim())} />
                  <SlugHint check={check} />
                </label>
                <button type="button" className={smallButtonClass} data-testid="site-rename" disabled={pending || check.state !== 'free' || rename === site.slug}
                  onClick={() => setConfirm({ title: t('scholarSites.rename'), body: t('scholarSites.renameBody'), label: t('scholarSites.rename'), danger: false, run: () => updateSite(channelId, { slug: rename }) })}>
                  {t('scholarSites.rename')}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-fg-muted">{t('scholarSites.noPermission')}</p>
      )}
      <div>
        <h3 className="text-sm font-medium mb-2">{t('scholarSites.history')}</h3>
        <ul className="text-sm space-y-1" data-testid="site-history">
          {detail?.history.map((h) => (
            <li key={h.id} className="text-fg-muted">
              <span dir="ltr">{h.action}</span> · {new Date(h.createdAt).toLocaleString(locale)} · <span dir="ltr">{h.actorId}</span>
            </li>
          ))}
        </ul>
      </div>
      <TierChangeDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? ''}
        danger={confirm?.danger}
        testId="site-confirm"
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && act(confirm.run)}
      />
    </div>
  );
}

export function SitesView({ sites, q, canManage, title }: { sites: SiteListItem[] | null; q: string; canManage: boolean; title: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const status = (s: SiteSettings | null): SiteStatus => s?.status ?? 'revoked';

  return (
    <div ref={top}>
      <PageHeader title={title} subtitle={t('scholarSites.intro')} t={t} />
      {notice && <Notice testId="sites-notice">{notice}</Notice>}
      {canManage && (
        <SectionCard title={t('scholarSites.grantTitle')} testId="sites-grant">
          <GrantForm onDone={(m) => { setNotice(m); router.refresh(); }} />
        </SectionCard>
      )}
      <SectionCard title={t('scholarSites.list')} testId="sites-list">
        <form method="get" className="mb-4" role="search">
          <Autocomplete kind="channel" mode="search" name="q" defaultValue={q} label={t('scholarSites.search')} testId="sites-search" />
        </form>
        {sites === null ? (
          <Notice tone="bad">{t('common.retry')}</Notice>
        ) : sites.length === 0 ? (
          <EmptyState>{t('scholarSites.empty')}</EmptyState>
        ) : (
          <div className={tableWrapClass}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thClass}>{t('scholarSites.channel')}</th>
                  <th className={thClass}>{t('scholarSites.host')}</th>
                  <th className={thClass}>{t('scholarSites.status')}</th>
                  <th className={thClass}>{t('scholarSites.tier')}</th>
                  <th className={thClass}>{t('scholarSites.grantedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <Fragment key={s.channelId}>
                    <tr className="border-t border-border" data-testid="site-row" data-channel={s.channelId}>
                      <td className={tdClass}>
                        <button type="button" className="underline text-start" aria-expanded={open === s.channelId} onClick={() => setOpen(open === s.channelId ? null : s.channelId)} data-testid="site-row-open">
                          {s.channel?.name ?? s.channelId}
                        </button>
                        {s.channel?.handle && <span dir="ltr" className="block text-fg-muted">@{s.channel.handle}</span>}
                      </td>
                      <td className={tdClass}><span dir="ltr" className="font-mono">{s.site?.hosts.find((h) => h.primary)?.host ?? '—'}</span></td>
                      <td className={tdClass}><Chip tone={STATUS_TONE[status(s.site)]}>{t(STATUS_KEY[status(s.site)])}</Chip></td>
                      <td className={tdClass}>{s.site ? t(TIER_KEY[s.site.tier]) : '—'}</td>
                      <td className={tdClass}><span dir="ltr">{s.grantedBy}</span></td>
                    </tr>
                    {open === s.channelId && (
                      <tr>
                        <td colSpan={5} className="p-4 bg-surface-2">
                          <SitePanel channelId={s.channelId} canManage={canManage} onChanged={() => router.refresh()} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
