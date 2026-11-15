'use client';

/** Studio → Social → Recent posts: what went out, what failed and why, with Try again (or post as a link). */
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { SocialDeliveryView } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { formatRelativeTime } from '@/lib/format/videoMeta';
import { linkFixes, reasonKey, socialClient } from '@/lib/studio/social-client';
import { NetworkMark, Notice, Pill, Section } from './shared';

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
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="social-delivery" data-status={item.status}>
                <NetworkMark network={item.network} className="h-8 w-8 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">{item.entityTitle || item.entityId}</p>
                  <p className="text-xs text-[var(--fanous-color-text-secondary)]">
                    <span>{s.networks[item.network]}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{s.events[item.event]}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={item.updatedAt}>{formatRelativeTime(item.updatedAt, locale)}</time>
                  </p>
                  {failed && item.error ? <p className="mt-1 text-xs text-[var(--fanous-color-error-text)]" data-testid="social-delivery-reason">{(d.reasons as Record<string, string>)[reasonKey(item.error)]}</p> : null}
                </div>
                <Pill tone={TONE[item.status]}>{d.status[item.status]}</Pill>
                {item.remoteUrl && item.status === 'sent' ? (
                  <a href={item.remoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm underline-offset-4 hover:underline">
                    {d.open}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : null}
                {item.status === 'failed' ? (
                  <div className="flex flex-wrap gap-2">
                    {linkFixes(item.error) && item.format === 'video' ? (
                      <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" disabled={busy === item.id} onClick={() => void retry(item, true)} data-testid="social-delivery-retry-link">
                        {d.retryAsLink}
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" disabled={busy === item.id} onClick={() => void retry(item, false)} data-testid="social-delivery-retry">
                        {d.retry}
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
