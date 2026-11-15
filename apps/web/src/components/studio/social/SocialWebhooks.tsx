'use client';

/**
 * Studio → Social → Webhooks: signed POSTs to Zapier, Make or any https URL when something new is published.
 * The signing secret is shown once (on create and on "New secret"); "Send test" sends a signed ping.
 */
import { useState } from 'react';
import { SOCIAL_WEBHOOK_EVENTS, type SocialWebhookEvent, type SocialWebhookView } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { socialClient } from '@/lib/studio/social-client';
import { CopyButton, Notice, Pill, Section, fill } from './shared';
import { RelativeDate } from '@/components/RelativeDate';

interface Props {
  channelId: string;
  locale: 'en' | 'ar';
  webhooks: SocialWebhookView[];
  limit: number;
  onWebhooks: (w: SocialWebhookView[]) => void;
}

export function SocialWebhooks({ channelId, locale, webhooks, limit, onWebhooks }: Props) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const w = s.webhooks;
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<SocialWebhookEvent[]>([...SOCIAL_WEBHOOK_EVENTS]);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const errorText = (code: string) => (w.errors as Record<string, string>)[code] ?? (s.errors as Record<string, string>)[code] ?? s.errors.generic;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    // The API applies the full URL rule (webhookUrlProblem) and names the problem; this only catches the obvious
    if (!url.trim()) return setFieldError(errorText('invalid_url'));
    if (!events.length) return setFieldError(errorText('events_required'));
    setFieldError(null);
    setBusy('create');
    const r = await socialClient.createWebhook(channelId, url.trim(), events);
    setBusy(null);
    if (!r.ok) return setFieldError(errorText(r.code));
    onWebhooks([...webhooks, r.data.webhook]);
    setSecret({ id: r.data.webhook.id, value: r.data.secret });
    setAdding(false);
    setUrl('');
  }

  async function toggle(hook: SocialWebhookView, enabled: boolean) {
    setBusy(hook.id);
    const r = await socialClient.updateWebhook(channelId, hook.id, { enabled });
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: errorText(r.code) });
    onWebhooks(webhooks.map((x) => (x.id === hook.id ? r.data.webhook : x)));
  }

  async function test(hook: SocialWebhookView) {
    setBusy(hook.id);
    const r = await socialClient.testWebhook(channelId, hook.id);
    setBusy(null);
    setMessage(r.ok ? { tone: 'ok', text: w.testSent } : { tone: 'error', text: errorText(r.code) });
  }

  async function rotate(hook: SocialWebhookView) {
    if (!(await confirm({ title: w.rotateConfirmTitle, description: w.rotateConfirmBody, confirmLabel: w.rotate, cancelLabel: s.accounts.cancel, danger: false, testId: 'social-webhook-rotate' }))) return;
    setBusy(hook.id);
    const r = await socialClient.rotateSecret(channelId, hook.id);
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: errorText(r.code) });
    setSecret({ id: hook.id, value: r.data.secret });
  }

  async function remove(hook: SocialWebhookView) {
    if (!(await confirm({ title: w.removeConfirmTitle, description: fill(w.removeConfirmBody, { url: hook.url }), confirmLabel: w.remove, cancelLabel: s.accounts.cancel, testId: 'social-webhook-remove' }))) return;
    setBusy(hook.id);
    const r = await socialClient.deleteWebhook(channelId, hook.id);
    setBusy(null);
    if (!r.ok) return setMessage({ tone: 'error', text: errorText(r.code) });
    onWebhooks(webhooks.filter((x) => x.id !== hook.id));
    if (secret?.id === hook.id) setSecret(null);
  }

  const lastTone = (h: SocialWebhookView) => (!h.lastStatus ? 'muted' : /^2\d\d$/.test(h.lastStatus) ? 'ok' : 'error');

  return (
    <Section
      id="social-webhooks"
      title={w.heading}
      intro={w.intro}
      testId="social-webhooks"
      action={
        !adding && webhooks.length < limit ? (
          <Button type="button" variant="secondary" className="min-h-11" onClick={() => setAdding(true)} data-testid="social-webhook-add">{w.add}</Button>
        ) : null
      }
    >
      {dialog}
      {adding ? (
        <form onSubmit={create} className="mb-4 space-y-3 rounded-lg border border-border p-4" data-testid="social-webhook-form" noValidate>
          <div className="space-y-1">
            <Label htmlFor="social-webhook-url">{w.url}</Label>
            <Input
              id="social-webhook-url"
              type="url"
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-describedby="social-webhook-url-hint"
              aria-invalid={!!fieldError}
            />
            <p id="social-webhook-url-hint" className="text-xs text-[var(--fanous-color-text-secondary)]">{w.urlHint}</p>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{w.events}</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {SOCIAL_WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={events.includes(ev)}
                    onChange={(e) => setEvents((list) => (e.target.checked ? [...list, ev] : list.filter((x) => x !== ev)))}
                  />
                  {w.eventNames[ev]}
                </label>
              ))}
            </div>
          </fieldset>
          {fieldError ? <p role="alert" className="text-sm text-[var(--fanous-color-error-text)]" data-testid="social-webhook-error">{fieldError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11" disabled={busy === 'create'} data-testid="social-webhook-create">{w.create}</Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => { setAdding(false); setFieldError(null); }}>{s.accounts.cancel}</Button>
          </div>
        </form>
      ) : null}

      {secret ? (
        <div className="mb-4 space-y-2 rounded-lg border-2 border-[var(--fanous-color-text-primary)] p-4" data-testid="social-webhook-secret" role="status">
          <p className="font-medium">{w.secretTitle}</p>
          <p className="text-sm">{w.secretOnce}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="max-w-full break-all rounded-md border border-border bg-[var(--fanous-color-surface-raised)] px-3 py-2 font-mono text-xs" data-testid="social-webhook-secret-value">{secret.value}</code>
            <CopyButton value={secret.value} label={w.copySecret} copiedLabel={s.feeds.copied} />
          </div>
        </div>
      ) : null}

      {message ? <div className="mb-3"><Notice tone={message.tone}>{message.text}</Notice></div> : null}

      {webhooks.length === 0 && !adding ? <p className="text-sm text-[var(--fanous-color-text-secondary)]">{w.none}</p> : null}
      <ul className="space-y-3">
        {webhooks.map((hook) => (
          <li key={hook.id} className="rounded-lg border border-border p-4" data-testid="social-webhook" data-enabled={hook.enabled ? '1' : '0'}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm" dir="ltr" title={hook.url}>{hook.url}</p>
                <p className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]">{hook.events.map((e) => (w.eventNames as Record<string, string>)[e] ?? e).join(' · ')}</p>
                {hook.lastDeliveryAt ? (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--fanous-color-text-secondary)]">
                    <span>{w.lastStatus}:</span>
                    <Pill tone={lastTone(hook)}>{hook.lastStatus}</Pill>
                    <RelativeDate value={hook.lastDeliveryAt} lang={locale} />
                  </p>
                ) : null}
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5" checked={hook.enabled} disabled={busy === hook.id} onChange={(e) => void toggle(hook, e.target.checked)} data-testid="social-webhook-enabled" />
                {w.enabled}
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" className="min-h-11 sm:min-h-9" disabled={busy === hook.id || !hook.enabled} onClick={() => void test(hook)} data-testid="social-webhook-test">{w.test}</Button>
              <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy === hook.id} onClick={() => void rotate(hook)}>{w.rotate}</Button>
              <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy === hook.id} onClick={() => void remove(hook)} data-testid="social-webhook-remove-open">{w.remove}</Button>
            </div>
          </li>
        ))}
      </ul>
      {webhooks.length >= limit ? <p className="mt-3 text-xs text-[var(--fanous-color-text-secondary)]">{fill(w.limit, { count: limit })}</p> : null}
    </Section>
  );
}
