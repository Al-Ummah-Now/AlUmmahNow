'use client';

/**
 * Studio → Social (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14): auto-post to X, Telegram, Bluesky and Mastodon,
 * the post text, recent posts, the channel's feeds for scheduler tools, and webhooks.
 */
import { useEffect, useRef, useState } from 'react';
import type { SocialLanguage } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import type { SocialOverview } from '@/lib/studio/social';
import { SocialAccounts } from './SocialAccounts';
import { SocialTemplates } from './SocialTemplates';
import { SocialDeliveries } from './SocialDeliveries';
import { SocialFeeds } from './SocialFeeds';
import { SocialWebhooks } from './SocialWebhooks';
import { Notice, fill } from './shared';
import { socialClient } from '@/lib/studio/social-client';

interface Props {
  channelId: string;
  locale: SocialLanguage;
  initial: SocialOverview;
  /** From the OAuth return: ?confirm=<id> to link the account, or ?error=oauth_denied */
  outcome?: { confirm?: string; error?: string };
}

export function SocialStudio({ channelId, locale, initial, outcome }: Props) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const [view, setView] = useState(initial);
  const [connected, setConnected] = useState<string | null>(null);
  const [error, setError] = useState(outcome?.error ?? null);
  const confirming = useRef(false);
  const connectedName = connected && (s.networks as Record<string, string>)[connected];

  // Back from the network: the account is linked only now, by the signed-in person who started connecting
  useEffect(() => {
    const id = outcome?.confirm;
    if (!id || confirming.current) return;
    confirming.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('confirm');
    window.history.replaceState(window.history.state, '', url);
    void socialClient.confirmConnect(channelId, id).then((r) => {
      if (!r.ok) {
        setError(r.code === 'connect_expired' ? 'oauth_expired' : r.code);
        return;
      }
      const account = r.data.account;
      setView((v) => ({ ...v, accounts: [...v.accounts.filter((a) => a.id !== account.id), account] }));
      setConnected(account.network);
    });
  }, [channelId, outcome?.confirm]);

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="studio-social">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="max-w-prose text-sm text-[var(--fanous-color-text-secondary)]">{s.intro}</p>
      </header>
      {connectedName ? <Notice tone="ok">{fill(s.accounts.connected, { network: connectedName })}</Notice> : null}
      {error ? <Notice tone="error">{(s.errors as Record<string, string>)[error] ?? s.errors.generic}</Notice> : null}
      <SocialAccounts channelId={channelId} locale={locale} accounts={view.accounts} networks={view.networks} onAccounts={(accounts) => setView((v) => ({ ...v, accounts }))} />
      <SocialTemplates channelId={channelId} locale={locale} templates={view.templates} accounts={view.accounts} preview={view.preview} onTemplates={(templates) => setView((v) => ({ ...v, templates }))} />
      <SocialDeliveries channelId={channelId} locale={locale} deliveries={view.deliveries} onDeliveries={(deliveries) => setView((v) => ({ ...v, deliveries }))} />
      <SocialFeeds locale={locale} feeds={view.feeds} />
      <SocialWebhooks channelId={channelId} locale={locale} webhooks={view.webhooks} limit={view.limits.webhooks} onWebhooks={(webhooks) => setView((v) => ({ ...v, webhooks }))} />
    </div>
  );
}
