'use client';

/** Studio → Social → Recent posts: what went out, what failed and why, with Try again (or post as a link). */
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { SocialDeliveryView } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { linkFixes, reasonKey, socialClient } from '@/lib/studio/social-client';
import { safeHttpUrl } from '@/lib/security/safe-input';
import { NetworkMark, Notice, Pill, Section } from './shared';
import { RelativeDate } from '@/components/RelativeDate';

import { MetaSep } from '@/components/ui/MetaSep';
const TONE = { sent: 'ok', queued: 'muted', sending: 'muted', failed: 'error', blocked: 'warn', cancelled: 'muted' } as const;

export function SocialDeliveries({ channelId, locale, deliveries, onDeliveries }: { channelId: string; locale: 'en' | 'ar'; deliveries: SocialDeliveryView[]; onDeliveries: (d: SocialDeliveryView[]) => void }) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const d = s.deliveries;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function retry(item: SocialDeliveryView, asLink: boolean) {
    setBusy(item.id);
    const r = await socialClient.retry(channelId, item.id, asLink ? 'link' : undefined);
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: s.errors.generic });
    onDeliveries(deliveries.map((x) => (x.id === item.id ? { ...x, status: 'queued', error: undefined, ...(asLink ? { format: 'link' as const } : {}) } : x)));
    setMessage({ tone: 'ok', text: d.retried });
  }

  return (
    <Section id="social-deliveries" title={d.heading} testId="social-deliveries">
      {message ? <div className="mb-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      {deliveries.length === 0 ? (
        <p className="text-sm text-[var(--fanous-color-text-secondary)]">{d.none}</p>
      ) : (
        <ul className="divide-y divide-border">
          {deliveries.map((item) => {
            const failed = item.status === 'failed' || item.status === 'blocked';
            return (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid="social-delivery" data-status={item.status}>
                {/* Phone: the title, details and status take the full row; the actions go underneath, so nothing is squeezed */}
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <NetworkMark network={item.network} className="h-8 w-8 shrink-0 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-start text-sm font-medium"><bdi>{item.entityTitle || item.entityId}</bdi></p>
                    <p className="text-xs text-[var(--fanous-color-text-secondary)]">
                      <span>{s.networks[item.network]}</span>
                      <MetaSep lang={locale} en="·" spaced />
                      <span>{s.events[item.event]}</span>
                      <MetaSep lang={locale} en="·" spaced />
                      <RelativeDate value={item.updatedAt} lang={locale} />
                    </p>
                    {failed && item.error ? <p className="mt-1 text-xs text-[var(--fanous-color-error-text)]" data-testid="social-delivery-reason">{(d.reasons as Record<string, string>)[reasonKey(item.error)]}</p> : null}
                  </div>
                  <span className="shrink-0"><Pill tone={TONE[item.status]}>{d.status[item.status]}</Pill></span>
                </div>
                {(() => {
                  const safeRemoteUrl = item.status === 'sent' ? safeHttpUrl(item.remoteUrl) : null;
                  if (!safeRemoteUrl && item.status !== 'failed') return null;
                  return (
                    <div className="flex flex-wrap gap-2 ps-11 sm:ps-0">
                      {safeRemoteUrl ? (
                        <a href={safeRemoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-4 hover:underline sm:min-h-9">
                          {d.open}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : null}
                      {item.status === 'failed' ? (
                        linkFixes(item.error) && item.format === 'video' ? (
                          <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" disabled={busy === item.id} onClick={() => void retry(item, true)} data-testid="social-delivery-retry-link">
                            {d.retryAsLink}
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" disabled={busy === item.id} onClick={() => void retry(item, false)} data-testid="social-delivery-retry">
                            {d.retry}
                          </Button>
                        )
                      ) : null}
                    </div>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
