'use client';

/**
 * Studio → Social (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14): auto-post to X, Telegram, Bluesky and Mastodon,
 * the post text, recent posts, the channel's feeds for scheduler tools, and webhooks.
 */
import { useState } from 'react';
import type { SocialLanguage } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import type { SocialOverview } from '@/lib/studio/social';
import { SocialAccounts } from './SocialAccounts';
import { SocialTemplates } from './SocialTemplates';
import { SocialDeliveries } from './SocialDeliveries';
import { SocialFeeds } from './SocialFeeds';
import { SocialWebhooks } from './SocialWebhooks';
import { Notice, fill } from './shared';

interface Props {
  channelId: string;
  locale: SocialLanguage;
  initial: SocialOverview;
  /** From the OAuth return (?connected=x or ?error=oauth_denied) */
  outcome?: { connected?: string; error?: string };
}

export function SocialStudio({ channelId, locale, initial, outcome }: Props) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const [view, setView] = useState(initial);
  const connectedName = outcome?.connected && (s.networks as Record<string, string>)[outcome.connected];

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="studio-social">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="max-w-prose text-sm text-[var(--fanous-color-text-secondary)]">{s.intro}</p>
      </header>
      {connectedName ? <Notice tone="ok">{fill(s.accounts.connected, { network: connectedName })}</Notice> : null}
      {outcome?.error ? <Notice tone="error">{(s.errors as Record<string, string>)[outcome.error] ?? s.errors.generic}</Notice> : null}
      <SocialAccounts channelId={channelId} locale={locale} accounts={view.accounts} networks={view.networks} onAccounts={(accounts) => setView((v) => ({ ...v, accounts }))} />
      <SocialTemplates channelId={channelId} templates={view.templates} onTemplates={(templates) => setView((v) => ({ ...v, templates }))} />
      <SocialDeliveries channelId={channelId} locale={locale} deliveries={view.deliveries} onDeliveries={(deliveries) => setView((v) => ({ ...v, deliveries }))} />
      <SocialFeeds locale={locale} feeds={view.feeds} />
      <SocialWebhooks channelId={channelId} locale={locale} webhooks={view.webhooks} limit={view.limits.webhooks} onWebhooks={(webhooks) => setView((v) => ({ ...v, webhooks }))} />
    </div>
  );
}
