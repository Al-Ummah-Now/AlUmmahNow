'use client';

/**
 * Studio → Social → Connected accounts: connect X, Telegram, Bluesky or Mastodon (owner 2026-11-14; no Meta),
 * pick the language each account posts in, and what it posts (new videos, Shorts, live streams, posts; the
 * video itself or a link). Telegram connects with a code posted in the channel by the person.
 */
import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  SOCIAL_EVENTS,
  SOCIAL_NETWORKS,
  formatsFor,
  type SocialAccountView,
  type SocialEvent,
  type SocialFormat,
  type SocialLanguage,
  type SocialNetwork,
} from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { socialClient, type ConnectResult } from '@/lib/studio/social-client';
import type { SocialOverview } from '@/lib/studio/social';
import { CopyButton, NetworkMark, Notice, Pill, Section, fill } from './shared';

interface Props {
  channelId: string;
  locale: SocialLanguage;
  accounts: SocialAccountView[];
  networks: SocialOverview['networks'];
  onAccounts: (accounts: SocialAccountView[]) => void;
}

type Pending = { network: 'bluesky' | 'mastodon'; value: string } | { network: 'telegram'; code: string; bot: string } | null;

export function SocialAccounts({ channelId, locale, accounts, networks, onAccounts }: Props) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const a = s.accounts;
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const { confirm, dialog } = useConfirm();
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const errorText = (code: string) => (s.errors as Record<string, string>)[code] ?? s.errors.generic;

  // Telegram: the code is accepted when the person posts it in the channel; poll until it is used
  useEffect(() => {
    if (pending?.network !== 'telegram') return;
    const code = pending.code;
    poll.current = setInterval(async () => {
      const r = await socialClient.telegramPending(channelId, code);
      if (r.ok && !r.data.pending) {
        if (poll.current) clearInterval(poll.current);
        const fresh = await socialClient.overview(channelId);
        if (fresh.ok) onAccounts(fresh.data.accounts);
        setPending(null);
        setMessage({ tone: 'ok', text: fill(a.connected, { network: s.networks.telegram }) });
      }
    }, 4000);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [pending, channelId, onAccounts, a.connected, s.networks.telegram]);

  async function start(network: SocialNetwork, extra: { handle?: string; instance?: string } = {}) {
    setBusy(`connect-${network}`);
    setMessage(null);
    const r = await socialClient.connect(channelId, { network, language: locale, returnLang: locale, ...extra });
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: errorText(r.code) });
    const result: ConnectResult = r.data;
    if (result.kind === 'redirect') window.location.assign(result.authorizeUrl);
    else setPending({ network: 'telegram', code: result.code, bot: `@${result.botUsername}` });
  }

  function onConnect(network: SocialNetwork) {
    if (network === 'bluesky' || network === 'mastodon') setPending({ network, value: '' });
    else void start(network);
  }

  async function save(account: SocialAccountView, patch: Parameters<typeof socialClient.updateAccount>[2]) {
    setBusy(account.id);
    const r = await socialClient.updateAccount(channelId, account.id, patch);
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: errorText(r.code) });
    onAccounts(accounts.map((x) => (x.id === account.id ? r.data.account : x)));
    setMessage({ tone: 'ok', text: a.saved });
  }

  function setRule(account: SocialAccountView, event: SocialEvent, change: Partial<{ enabled: boolean; format: SocialFormat; includeLink: boolean }>) {
    const rules = SOCIAL_EVENTS.map((e) => {
      const r = account.rules.find((x) => x.event === e) ?? { event: e, enabled: false, format: formatsFor(e)[0]!, includeLink: false };
      return e === event ? { ...r, ...change } : r;
    });
    void save(account, { rules });
  }

  async function remove(account: SocialAccountView) {
    const ok = await confirm({
      title: fill(a.disconnectConfirmTitle, { handle: account.handle }),
      description: fill(a.disconnectConfirmBody, { network: s.networks[account.network] }),
      confirmLabel: a.disconnect,
      cancelLabel: a.cancel,
      testId: 'social-disconnect',
    });
    if (!ok) return;
    setBusy(account.id);
    const r = await socialClient.disconnect(channelId, account.id);
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: errorText(r.code) });
    onAccounts(accounts.filter((x) => x.id !== account.id));
  }

  const statusTone = (st: SocialAccountView['status']) => (st === 'active' ? 'ok' : st === 'needs_reconnect' ? 'warn' : 'error');

  return (
    <Section id="social-accounts" title={a.heading} testId="social-accounts">
      {dialog}
      <ul className="grid gap-3 sm:grid-cols-2" aria-label={a.connect}>
        {SOCIAL_NETWORKS.map((network) => {
          const n = networks[network];
          const available = n?.available;
          return (
            <li key={network} className="flex items-center gap-3 rounded-lg border border-border bg-[var(--fanous-color-surface)] p-3" data-testid={`social-network-${network}`}>
              <NetworkMark network={network} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.networks[network]}</p>
                {!available ? <p className="text-xs text-[var(--fanous-color-text-secondary)]">{n?.configured ? a.paused : a.unavailable}</p> : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={!available || busy === `connect-${network}`}
                onClick={() => onConnect(network)}
                aria-label={fill(a.connectNetwork, { network: s.networks[network] })}
                data-testid={`social-connect-${network}`}
              >
                {a.connect}
              </Button>
            </li>
          );
        })}
      </ul>

      {pending && pending.network !== 'telegram' ? (
        <form
          className="mt-4 space-y-3 rounded-lg border border-border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start(pending.network, pending.network === 'bluesky' ? { handle: pending.value } : { instance: pending.value });
          }}
          data-testid={`social-connect-form-${pending.network}`}
        >
          <Label htmlFor="social-connect-input">{pending.network === 'bluesky' ? a.blueskyHandle : a.mastodonInstance}</Label>
          <Input
            id="social-connect-input"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={pending.value}
            onChange={(e) => setPending({ ...pending, value: e.target.value })}
            aria-describedby="social-connect-hint"
            required
          />
          <p id="social-connect-hint" className="text-xs text-[var(--fanous-color-text-secondary)]">
            {pending.network === 'bluesky' ? a.blueskyHandleHint : a.mastodonInstanceHint}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11" disabled={!pending.value.trim() || !!busy}>{a.continue}</Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setPending(null)}>{a.cancel}</Button>
          </div>
        </form>
      ) : null}

      {pending?.network === 'telegram' ? (
        <div className="mt-4 space-y-3 rounded-lg border border-border p-4" data-testid="social-telegram-code">
          <h3 className="font-medium">{a.telegram.heading}</h3>
          <ol className="list-decimal space-y-2 ps-5 text-sm">
            <li>{fill(a.telegram.step1, { bot: pending.bot })}</li>
            <li>
              {a.telegram.step2}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code dir="ltr" className="rounded-md border border-border bg-[var(--fanous-color-surface-raised)] px-3 py-2 font-mono text-base tracking-wider" data-testid="social-telegram-code-value">
                  {pending.code}
                </code>
                <CopyButton value={pending.code} label={a.telegram.copyCode} copiedLabel={s.feeds.copied} />
              </div>
            </li>
          </ol>
          <p className="text-sm text-[var(--fanous-color-text-secondary)]" role="status">{a.telegram.waiting} {a.telegram.expires}</p>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setPending(null)}>{a.cancel}</Button>
        </div>
      ) : null}

      {message ? <div className="mt-4"><Notice tone={message.tone}>{message.text}</Notice></div> : null}

      <div className="mt-6 space-y-4">
        {accounts.length === 0 ? <p className="text-sm text-[var(--fanous-color-text-secondary)]">{a.none}</p> : null}
        {accounts.map((account) => (
          <article key={account.id} className="rounded-lg border border-border p-4" data-testid={`social-account-${account.network}`} data-status={account.status} aria-labelledby={`acc-${account.id}`}>
            <header className="flex flex-wrap items-center gap-3">
              <NetworkMark network={account.network} />
              <div className="min-w-0 flex-1">
                <h3 id={`acc-${account.id}`} className="truncate font-medium" dir="auto">{account.displayName || account.handle}</h3>
                <p className="truncate text-sm text-[var(--fanous-color-text-secondary)]" dir="ltr">
                  {account.profileUrl ? (
                    <a href={account.profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                      {account.handle}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    account.handle
                  )}
                </p>
              </div>
              <Pill tone={statusTone(account.status)} testId="social-account-status">{a.status[account.status]}</Pill>
            </header>

            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr]">
              <div className="space-y-1">
                <Label id={`lang-${account.id}`} className="block">{a.postsIn}</Label>
                <ThemedSelectField
                  id={`lang-${account.id}-v`}
                  aria-labelledby={`lang-${account.id} lang-${account.id}-v`}
                  value={account.language}
                  disabled={busy === account.id}
                  onChange={(e) => void save(account, { language: e.target.value as SocialLanguage })}
                  data-testid="social-account-language"
                >
                  <option value="en">{s.languages.en}</option>
                  <option value="ar">{s.languages.ar}</option>
                </ThemedSelectField>
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">{a.rulesHeading}</legend>
                {SOCIAL_EVENTS.map((event) => {
                  const rule = account.rules.find((r) => r.event === event);
                  const formats = formatsFor(event);
                  const id = `rule-${account.id}-${event}`;
                  return (
                    <div key={event} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border px-3 py-2" data-testid={`social-rule-${event}`}>
                      <label htmlFor={id} className="flex min-h-11 flex-1 items-center gap-2 text-sm sm:min-h-9">
                        <input
                          id={id}
                          type="checkbox"
                          className="h-5 w-5 accent-[var(--fanous-color-text-primary)]"
                          checked={!!rule?.enabled}
                          disabled={busy === account.id || account.status !== 'active'}
                          onChange={(e) => setRule(account, event, { enabled: e.target.checked })}
                        />
                        {s.events[event]}
                      </label>
                      {formats.length > 1 && rule?.enabled ? (
                        <div className="flex items-center gap-2 text-sm">
                          <span id={`${id}-f`} className="text-[var(--fanous-color-text-secondary)]">{a.format}</span>
                          <ThemedSelectField id={`${id}-fv`} aria-labelledby={`${id}-f ${id}-fv`} value={rule.format} onChange={(e) => setRule(account, event, { format: e.target.value as SocialFormat })} data-testid={`social-rule-${event}-format`}>
                            {formats.map((f) => (
                              <option key={f} value={f}>{a.formats[f]}</option>
                            ))}
                          </ThemedSelectField>
                        </div>
                      ) : null}
                      {account.network === 'x' && rule?.enabled && rule.format === 'video' ? (
                        <label className="flex min-h-11 w-full items-center gap-2 text-sm sm:min-h-9">
                          <input type="checkbox" className="h-5 w-5" checked={rule.includeLink} onChange={(e) => setRule(account, event, { includeLink: e.target.checked })} />
                          {a.includeLink}
                        </label>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            </div>

            <footer className="mt-4 flex flex-wrap gap-2">
              {account.status !== 'active' && networks[account.network]?.available ? (
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => onConnect(account.network)} data-testid="social-reconnect">{a.reconnect}</Button>
              ) : null}
              <Button type="button" variant="ghost" className="min-h-11" disabled={busy === account.id} onClick={() => void remove(account)} data-testid="social-disconnect-open">{a.disconnect}</Button>
            </footer>
          </article>
        ))}
      </div>
    </Section>
  );
}
