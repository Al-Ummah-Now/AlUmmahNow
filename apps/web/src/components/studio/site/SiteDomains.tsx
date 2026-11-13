'use client';

/**
 * Studio → Site → Domains (wiki AUN-SCHOLAR-SITES §4.2, #1212): add an own domain, copy the DNS
 * records it needs, watch its status (checked again every 30 s while one is pending and this page
 * is open; admin-api's cron checks too), pick the main address, remove a domain (in-app dialog).
 * While Cloudflare for SaaS is not enabled on the zone, the section says own domains aren't
 * available yet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteDnsRecord, SiteDomain, SiteHost, StudioTranslations } from '@al-ummah/shared-types';

type DomainStrings = StudioTranslations['site']['domains'];
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export interface DomainsView {
  domains: SiteDomain[];
  hosts: SiteHost[];
  primaryHost: string | null;
  limit: number;
}

type Answer<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

async function call<T>(channelId: string, path: string, init: RequestInit = {}): Promise<Answer<T>> {
  try {
    const res = await fetch(`/api/studio/site-domains/${encodeURIComponent(channelId)}${path}`, { ...init, cache: 'no-store', headers: init.body ? { 'Content-Type': 'application/json' } : undefined });
    const body = (await res.json().catch(() => null)) as { success?: boolean; code?: string; result?: T } | null;
    if (!res.ok || !body?.success) return { ok: false, status: res.status, code: body?.code ?? 'generic' };
    return { ok: true, data: body.result as T };
  } catch (error) {
    logger.warn('[SiteDomains] request failed', { channelId, path, error: String(error) });
    return { ok: false, status: 0, code: 'generic' };
  }
}

const POLL_MS = 30_000;

export function SiteDomains({ channelId, locale }: { channelId: string; locale: string }) {
  const { t } = useLanguage();
  const d = t.studio.site.domains;
  const [view, setView] = useState<DomainsView | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [host, setHost] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const pending = view?.domains.some((x) => x.status === 'waiting_dns' || x.status === 'issuing') ?? false;
  const mounted = useRef(true);

  const errorText = (code: string) => (d.errors as Record<string, string>)[code] ?? d.errors.generic;

  const load = useCallback(async () => {
    const r = await call<DomainsView>(channelId, '');
    if (!mounted.current) return;
    if (r.ok) setView(r.data);
    else if (r.code === 'saas_unavailable') setUnavailable(true);
    else setMessage({ tone: 'error', text: errorText(r.code) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Check pending domains again while the page is open and visible
  useEffect(() => {
    if (!pending || !view) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      for (const x of view.domains) if (x.status === 'waiting_dns' || x.status === 'issuing') void refresh(x.host, true);
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, view]);

  const replaceDomain = (domain: SiteDomain) => setView((v) => (v ? { ...v, domains: v.domains.map((x) => (x.host === domain.host ? domain : x)) } : v));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim()) return;
    setBusy('add');
    setMessage(null);
    const r = await call<{ domain: SiteDomain }>(channelId, '', { method: 'POST', body: JSON.stringify({ host }) });
    setBusy(null);
    if (!r.ok) {
      if (r.code === 'saas_unavailable') setUnavailable(true);
      else setMessage({ tone: 'error', text: errorText(r.code) });
      return;
    }
    setHost('');
    setView((v) => (v ? { ...v, domains: [...v.domains, r.data.domain] } : v));
  }

  async function refresh(h: string, quiet = false) {
    if (!quiet) setBusy(`check:${h}`);
    const r = await call<{ domain: SiteDomain }>(channelId, `/${encodeURIComponent(h)}/refresh`, { method: 'POST', body: '{}' });
    if (!quiet) setBusy(null);
    if (r.ok) {
      replaceDomain(r.data.domain);
      if (r.data.domain.status === 'live') void load(); // the hosts changed
    } else if (!quiet) setMessage({ tone: 'error', text: errorText(r.code) });
  }

  async function makePrimary(h: string) {
    setBusy(`primary:${h}`);
    const r = await call<DomainsView>(channelId, '/primary', { method: 'PUT', body: JSON.stringify({ host: h }) });
    setBusy(null);
    if (r.ok) setView(r.data);
    else setMessage({ tone: 'error', text: errorText(r.code) });
  }

  async function remove(h: string) {
    const ok = await confirm({ title: d.removeTitle.replace('{host}', h), description: d.removeBody, confirmLabel: d.remove, cancelLabel: d.cancel, danger: true, testId: 'site-domain-remove-dialog' });
    if (!ok) return;
    setBusy(`remove:${h}`);
    const r = await call<DomainsView>(channelId, `/${encodeURIComponent(h)}`, { method: 'DELETE' });
    setBusy(null);
    if (r.ok) setView(r.data);
    else setMessage({ tone: 'error', text: errorText(r.code) });
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');

  return (
    <section aria-labelledby="site-domains-h" className="space-y-3" data-testid="site-domains">
      <h2 id="site-domains-h" className="text-lg font-medium">{d.title}</h2>
      <p className="text-sm text-[var(--fanous-color-text-secondary)]">{d.intro}</p>
      {unavailable ? (
        <p role="status" className="text-sm" data-testid="site-domains-unavailable">{d.unavailable}</p>
      ) : !view ? null : (
        <>
          {view.hosts.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">{d.primary}</h3>
              <p className="text-sm text-[var(--fanous-color-text-secondary)]">{d.primaryHint}</p>
              <ul className="space-y-1">
                {view.hosts.map((h) => (
                  <li key={h.host} className="flex flex-wrap items-center gap-2">
                    <bdi dir="ltr" className="font-mono text-sm">{h.host}</bdi>
                    {h.primary ? (
                      <span className="text-xs rounded-full px-2 py-0.5 bg-[var(--fanous-color-surface-raised)]" data-testid="site-primary-host">{d.primary}</span>
                    ) : (
                      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy !== null} onClick={() => void makePrimary(h.host)}>
                        {d.makePrimary}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.limit < 1 ? (
            <p className="text-sm" data-testid="site-domains-not-included">{d.notIncluded}</p>
          ) : (
            <form onSubmit={add} className="space-y-2" aria-describedby="site-domain-limit">
              <Label htmlFor="site-domain-host">{d.addLabel}</Label>
              <div className="flex flex-wrap gap-2">
                <Input id="site-domain-host" dir="ltr" inputMode="url" autoComplete="off" spellCheck={false} placeholder={d.addHint} value={host} onChange={(e) => setHost(e.target.value)} className="max-w-sm" disabled={view.domains.length >= view.limit} />
                <Button type="submit" className="min-h-11" disabled={busy !== null || !host.trim() || view.domains.length >= view.limit} data-testid="site-domain-add">
                  {busy === 'add' ? d.adding : d.add}
                </Button>
              </div>
              <p id="site-domain-limit" className="text-xs text-[var(--fanous-color-text-muted)]">{d.limit.replace('{n}', String(view.limit))}</p>
            </form>
          )}

          {view.domains.length === 0 ? (
            view.limit > 0 && <p className="text-sm text-[var(--fanous-color-text-muted)]">{d.none}</p>
          ) : (
            <ul className="space-y-4">
              {view.domains.map((x) => (
                <li key={x.host} className="rounded-lg border border-[var(--fanous-color-divider)] p-3 space-y-3" data-testid="site-domain" data-status={x.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <bdi dir="ltr" className="font-mono font-medium">{x.host}</bdi>
                    <span className="text-xs rounded-full px-2 py-0.5 bg-[var(--fanous-color-surface-raised)]" data-testid="site-domain-status">{d.status[x.status]}</span>
                    {x.checkedAt && <span className="text-xs text-[var(--fanous-color-text-muted)]">{d.checkedAt.replace('{time}', time(x.checkedAt))}</span>}
                  </div>
                  {x.error && x.status !== 'live' && <p className="text-sm" dir="ltr">{x.error}</p>}
                  {x.status !== 'live' && <DnsRecords d={d} records={x.records} copied={copied} onCopy={copy} />}
                  {x.status !== 'live' && !x.host.startsWith('www.') && x.host.split('.').length === 2 && <p className="text-sm text-[var(--fanous-color-text-secondary)]">{d.apexHint}</p>}
                  <div className="flex flex-wrap gap-2">
                    {x.status !== 'live' && (
                      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy !== null} onClick={() => void refresh(x.host)}>
                        {busy === `check:${x.host}` ? d.checking : d.checkNow}
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy !== null} onClick={() => void remove(x.host)} data-testid="site-domain-remove">
                      {d.remove}
                      <span className="sr-only"> {x.host}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {pending && <p className="text-xs text-[var(--fanous-color-text-muted)]">{d.recordsHint}</p>}
        </>
      )}
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-sm text-[var(--fanous-color-error-text)]' : 'text-sm'}>
          {message.text}
        </p>
      )}
      {dialog}
    </section>
  );

}

function DnsRecords({ d, records, copied: copiedId, onCopy }: { d: DomainStrings; records: SiteDnsRecord[]; copied: string | null; onCopy: (text: string, id: string) => void }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{d.recordsTitle}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start">
              <th scope="col" className="text-start pe-3">{d.type}</th>
              <th scope="col" className="text-start pe-3">{d.name}</th>
              <th scope="col" className="text-start">{d.value}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => {
              const id = `${r.name}-${i}`;
              return (
                <tr key={id} className="align-top border-t border-[var(--fanous-color-divider)]">
                  <td className="py-2 pe-3 font-mono">{r.type}</td>
                  <td className="py-2 pe-3">
                    <code dir="ltr" className="break-all">{r.name}</code>
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 ms-1" onClick={() => onCopy(r.name, `${id}-n`)} aria-label={d.copyLabel.replace('{what}', `${d.name} ${r.name}`)}>
                      {copiedId === `${id}-n` ? d.copied : d.copy}
                    </Button>
                  </td>
                  <td className="py-2">
                    <code dir="ltr" className="break-all">{r.value}</code>
                    <Button type="button" variant="ghost" size="sm" className="min-h-11 ms-1" onClick={() => onCopy(r.value, `${id}-v`)} aria-label={d.copyLabel.replace('{what}', `${d.value} ${r.value}`)}>
                      {copiedId === `${id}-v` ? d.copied : d.copy}
                    </Button>
                    <p className="text-xs text-[var(--fanous-color-text-muted)]">{d.purpose[r.purpose]}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
