'use client';

/**
 * The Status page's Subscriptions card (docs/status-page/README.md "Subscriptions"): email
 * subscriber counts (never addresses) with removal of one address on request, webhooks (add with
 * a signing secret shown once, delete) and the recent notifications with their delivery counts and
 * "Send failed again". Every change goes through admin-api /api/status (status:manage, audited).
 */
import { useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, formatNumber, type MessageKey } from '@/i18n/translate';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { smallButtonClass } from '@/components/content/parts';
import { addStatusWebhook, deleteStatusWebhook, removeStatusSubscriber, retryStatusNotification } from '@/lib/api/status';
import type { StatusSubscriptions as Subs } from '@/lib/api/status-types';
import { deliveryErrorKey } from './model';

const labelClass = 'block text-sm font-medium text-fg mb-1';
const STATE_CLASS: Record<string, string> = { sent: 'text-success-fg', sunk: 'text-success-fg', failed: 'text-danger-fg', queued: 'text-fg-muted', skipped: 'text-fg-muted' };

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  const { locale } = useLanguage();
  return (
    <div className="flex-1 rounded-lg border border-border bg-surface-2 px-4 py-3 min-w-32" data-testid={testId} data-value={value}>
      <p className="text-2xl font-bold tabular-nums text-fg">{formatNumber(value, locale)}</p>
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}

function SecretBox({ secret }: { secret: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-border border-s-4 border-s-warning-fg bg-surface-2 p-3" role="status" data-testid="status-webhook-secret">
      <p className="font-semibold text-fg">{t('statusPage.subs.secretTitle')}</p>
      <p className="text-sm text-fg-muted mb-2">{t('statusPage.subs.secretNote')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-surface px-2 py-1 text-sm text-fg" dir="ltr" data-testid="status-webhook-secret-value">{secret}</code>
        <button
          type="button"
          className={smallButtonClass}
          onClick={() => {
            void navigator.clipboard?.writeText(secret).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? t('statusPage.subs.copied') : t('statusPage.subs.copy')}
        </button>
      </div>
    </div>
  );
}

function Webhooks({ items }: { items: Subs['webhooks'] }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const [secret, setSecret] = useState<string | null>(null);
  const deliveryErrorText = (error: string) => {
    const e = deliveryErrorKey(error);
    return e.key === 'statusPage.subs.deliveryHttp' ? t(e.key, { status: e.status }) : t(e.key);
  };

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    setSecret(null);
    const created = await run('add', () => addStatusWebhook({ name: String(d.get('name') ?? ''), url: String(d.get('url') ?? '') }), { success: t('statusPage.subs.added') });
    if (created) {
      setSecret(created.secret);
      form.reset();
    }
  }

  return (
    <div data-testid="status-webhooks">
      <h3 className="font-semibold text-fg">{t('statusPage.subs.webhooksTitle')}</h3>
      <p className="text-sm text-fg-muted mb-3">{t('statusPage.subs.webhooksNote')}</p>
      {items.length === 0 ? (
        <p className="text-fg-muted mb-3" data-testid="status-webhooks-empty">{t('statusPage.subs.webhooksEmpty')}</p>
      ) : (
        <ul className="mb-3 divide-y divide-border rounded-lg border border-border">
          {items.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-3 p-3" data-testid="status-webhook-row" data-id={w.id}>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-fg" dir="auto">{w.name}</p>
                <p className="text-sm text-fg-muted break-all" dir="ltr">{w.url}</p>
                <p className="text-sm text-fg-muted">
                  {t('statusPage.subs.lastDelivery')}:{' '}
                  {w.last ? (
                    <>
                      <span className={`font-medium ${STATE_CLASS[w.last.status] ?? ''}`} data-testid="status-webhook-last">{t(`statusPage.subs.deliveryStates.${w.last.status}` as MessageKey)}</span> • {formatDate(w.last.at, locale, true)}
                      {w.last.error && w.last.status === 'failed' && <> • <span data-testid="status-webhook-error">{deliveryErrorText(w.last.error)}</span></>}
                    </>
                  ) : (
                    t('statusPage.subs.never')
                  )}
                </p>
              </div>
              <div className="shrink-0">
              <ConfirmButton
                label={t('statusPage.subs.deleteWebhook')}
                title={t('statusPage.subs.deleteTitle', { name: w.name })}
                body={t('statusPage.subs.deleteBody')}
                confirmLabel={t('statusPage.subs.deleteWebhook')}
                danger
                busy={busy === `del:${w.id}`}
                disabled={busy !== null}
                testId={`status-webhook-delete-${w.id}`}
                onConfirm={() => run(`del:${w.id}`, () => deleteStatusWebhook(w.id), { success: t('statusPage.subs.webhookDeleted') })}
              />
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_2fr_auto] md:items-end" data-testid="status-webhook-form">
        <div>
          <label htmlFor="status-webhook-name" className={labelClass}>{t('statusPage.subs.name')}</label>
          <input id="status-webhook-name" name="name" required maxLength={80} className={`${fieldClass} w-full`} data-testid="status-webhook-name" />
        </div>
        <div>
          <label htmlFor="status-webhook-url" className={labelClass}>{t('statusPage.subs.url')}</label>
          <input id="status-webhook-url" name="url" type="url" required maxLength={500} pattern="https://.+" dir="ltr" placeholder="https://" className={`${fieldClass} w-full`} data-testid="status-webhook-url" />
        </div>
        <button type="submit" className={primaryButtonClass} disabled={busy !== null} data-testid="status-webhook-add">
          {busy === 'add' ? t('content.working') : t('statusPage.subs.add')}
        </button>
      </form>
      <ActionFeedback error={error} message={message} testId="status-webhook-feedback" />
      {secret && <SecretBox secret={secret} />}
    </div>
  );
}

function RemoveEmail() {
  const { t } = useLanguage();
  const { run, busy, error } = useContentAction();
  const [note, setNote] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setNote(null);
    const out = await run('remove', () => removeStatusSubscriber(String(new FormData(form).get('email') ?? '')));
    if (out) {
      setNote(out.removed ? t('statusPage.subs.removed') : t('statusPage.subs.notFound'));
      form.reset();
    }
  }
  return (
    <form onSubmit={submit} className="mt-4" data-testid="status-remove-form">
      <h4 className="font-medium text-fg">{t('statusPage.subs.removeTitle')}</h4>
      <p className="text-sm text-fg-muted mb-2">{t('statusPage.subs.removeNote')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grow min-w-56">
          <label htmlFor="status-remove-email" className={labelClass}>{t('statusPage.subs.removeLabel')}</label>
          <input id="status-remove-email" name="email" type="email" required maxLength={254} dir="ltr" autoComplete="off" className={`${fieldClass} w-full`} data-testid="status-remove-email" />
        </div>
        <button type="submit" className={smallButtonClass} disabled={busy !== null} data-testid="status-remove-submit">
          {busy === 'remove' ? t('content.working') : t('statusPage.subs.removeButton')}
        </button>
      </div>
      <ActionFeedback error={error} message={note} testId="status-remove-feedback" />
    </form>
  );
}

function History({ items }: { items: Subs['notifications'] }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  if (!items.length) return <p className="text-fg-muted" data-testid="status-notifications-empty">{t('statusPage.subs.historyEmpty')}</p>;
  const retryButton = (n: Subs['notifications'][number], testId = true) =>
    (n.failed > 0 || !n.fannedOutAt) && (
      <button type="button" className={smallButtonClass} disabled={busy !== null} data-testid={testId ? `status-notification-retry-${n.id}` : undefined} onClick={() => void run(`retry:${n.id}`, () => retryStatusNotification(n.id), { success: t('statusPage.subs.retried') })}>
        {busy === `retry:${n.id}` ? t('content.working') : t('statusPage.subs.retry')}
      </button>
    );
  const titleOf = (n: Subs['notifications'][number]) => (locale === 'ar' ? n.titleAr : n.titleEn) ?? t('statusPage.subs.deletedIncident');
  return (
    <div>
      <ActionFeedback error={error} message={message} />
      {/* Phones: one card per notification (the table needs more width than a phone has) */}
      <ul className="space-y-3 md:hidden" aria-label={t('statusPage.subs.historyTitle')}>
        {items.map((n) => (
          <li key={n.id} className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <p className="font-medium text-fg" dir="auto">{titleOf(n)}</p>
            <p className="text-fg-muted">{t(`statusPage.subs.events.${n.event}` as MessageKey)} • {formatDate(n.createdAt, locale, true)}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <div><dt className="text-fg-muted">{t('statusPage.subs.recipients')}</dt><dd className="tabular-nums text-fg">{n.fannedOutAt ? formatNumber(n.recipients ?? 0, locale) : t('statusPage.subs.sending')}</dd></div>
              <div><dt className="text-fg-muted">{t('statusPage.subs.delivered')}</dt><dd className="tabular-nums text-fg">{formatNumber(n.sent, locale)}</dd></div>
              <div><dt className="text-fg-muted">{t('statusPage.subs.failed')}</dt><dd className={`tabular-nums ${n.failed ? 'font-semibold text-danger-fg' : 'text-fg'}`}>{formatNumber(n.failed, locale)}</dd></div>
            </dl>
            {n.queued > 0 && <p className="mt-1 text-xs text-fg-muted">{t('statusPage.subs.waiting')}: {formatNumber(n.queued, locale)}</p>}
            {(n.failed > 0 || !n.fannedOutAt) && <div className="mt-2">{retryButton(n, false)}</div>}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm" data-testid="status-notifications">
        <caption className="sr-only">{t('statusPage.subs.historyTitle')}</caption>
        <thead>
          <tr className="text-fg-muted">
            <th scope="col" className="p-2 text-start font-medium">{t('statusPage.subs.update')}</th>
            <th scope="col" className="p-2 text-start font-medium">{t('statusPage.subs.when')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('statusPage.subs.recipients')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('statusPage.subs.delivered')}</th>
            <th scope="col" className="p-2 text-end font-medium">{t('statusPage.subs.failed')}</th>
            <th scope="col" className="p-2"><span className="sr-only">{t('statusPage.subs.retry')}</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((n) => {
            const title = titleOf(n);
            return (
              <tr key={n.id} className="border-t border-border align-top" data-testid="status-notification-row" data-id={n.id} data-incident={n.incidentId} data-sent={n.sent} data-failed={n.failed}>
                <th scope="row" className="p-2 text-start font-normal">
                  <span className="block text-fg" dir="auto">{title}</span>
                  <span className="text-fg-muted">{t(`statusPage.subs.events.${n.event}` as MessageKey)}</span>
                </th>
                <td className="p-2 whitespace-nowrap text-fg-muted">{formatDate(n.createdAt, locale, true)}</td>
                <td className="p-2 text-end tabular-nums text-fg-muted">{n.fannedOutAt ? formatNumber(n.recipients ?? 0, locale) : t('statusPage.subs.sending')}</td>
                <td className="p-2 text-end tabular-nums text-fg">
                  {formatNumber(n.sent, locale)}
                  {n.queued > 0 && <span className="block text-xs text-fg-muted">{t('statusPage.subs.waiting')}: {formatNumber(n.queued, locale)}</span>}
                </td>
                <td className={`p-2 text-end tabular-nums ${n.failed ? 'font-semibold text-danger-fg' : 'text-fg-muted'}`}>{formatNumber(n.failed, locale)}</td>
                <td className="p-2 text-end">{retryButton(n)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export function StatusSubscriptions({ data }: { data: Subs }) {
  const { t } = useLanguage();
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="status-subs-title" data-testid="status-subscriptions">
      <h2 id="status-subs-title" className="text-lg font-semibold text-fg mb-1">{t('statusPage.subs.title')}</h2>
      <p className="text-sm text-fg-muted mb-4">{t('statusPage.subs.note')}</p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold text-fg">{t('statusPage.subs.emailTitle')}</h3>
          <p className="text-sm text-fg-muted mb-3">{t('statusPage.subs.emailNote')}</p>
          <div className="flex flex-wrap gap-3">
            <Stat label={t('statusPage.subs.active')} value={data.email.active} testId="status-subs-active" />
            <Stat label={t('statusPage.subs.pending')} value={data.email.pending} testId="status-subs-pending" />
          </div>
          <RemoveEmail />
        </div>
        <Webhooks items={data.webhooks} />
      </div>
      <h3 className="font-semibold text-fg mt-6 mb-2">{t('statusPage.subs.historyTitle')}</h3>
      <History items={data.notifications} />
    </section>
  );
}
