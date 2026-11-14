'use client';

/**
 * The CSAM list page's forms (docs/specs/CSAM-RESPONSE.md): paste a Cloudflare alert (each of our
 * URLs opens a case; mapped ones are taken down and the uploader frozen at once), the evidence
 * retention (365–3650 days) and the Cloudflare webhook secret, shown once. All need a fresh
 * sign-in, which toResult sends the browser through.
 */
import { useId, useState } from 'react';
import Link from '@/components/AppLink';
import { CSAM_RETENTION_MAX_DAYS, CSAM_RETENTION_MIN_DAYS, type CsamSettings } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass, linkClass, primaryButtonClass } from '@/components/ui';
import { generateCsamWebhookSecret, setCsamRetentionDays, submitCsamIntake, type CsamIntakeResult } from '@/lib/api/csam';

const labelClass = 'block text-sm font-medium text-fg mb-1';

/** Copies a value; when the clipboard is refused the field is focused for a manual copy. */
export function CopyButton({ value, fallbackId, testId, label }: { value: string; fallbackId?: string; testId: string; label?: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2" aria-live="polite">
      <button
        type="button"
        className={smallButtonClass}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            if (fallbackId) (document.getElementById(fallbackId) as HTMLInputElement | null)?.select();
          }
        }}
        data-testid={testId}
      >
        {label ?? t('csamPage.copy')}
      </button>
      {copied && <span className="text-success-fg text-sm">{t('csamPage.copied')}</span>}
    </span>
  );
}

export function IntakeForm() {
  const { t } = useLanguage();
  const id = useId();
  const { run, busy, error } = useContentAction();
  const [result, setResult] = useState<CsamIntakeResult | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const text = String(new FormData(form).get('text') ?? '');
    if (!text.trim()) return;
    const out = await run('intake', () => submitCsamIntake(text));
    if (out) {
      setResult(out);
      form.reset();
    }
  }

  return (
    <section className={`${cardClass} mb-6 border-danger-border`} aria-labelledby={`${id}-title`} data-testid="csam-intake">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-1">{t('csamPage.intake.title')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t('csamPage.intake.note')}</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor={`${id}-text`} className={labelClass}>{t('csamPage.intake.label')}</label>
          <textarea id={`${id}-text`} name="text" required rows={5} maxLength={256 * 1024} dir="ltr" className={`${fieldClass} w-full font-mono text-sm`} data-testid="csam-intake-text" />
        </div>
        <ActionFeedback error={error} message={null} testId="csam-intake-feedback" />
        <button type="submit" className={primaryButtonClass} disabled={busy !== null} data-testid="csam-intake-submit">
          {busy ? t('content.working') : t('csamPage.intake.submit')}
        </button>
      </form>
      {result && (
        <div className="mt-4 text-sm space-y-1" aria-live="polite" data-testid="csam-intake-result">
          {result.cases.length === 0 && result.existing.length === 0 && <p className="text-fg-muted">{t('csamPage.intake.none')}</p>}
          {result.cases.length > 0 && (
            <div>
              <p className="text-fg font-medium">{t('csamPage.intake.opened', { count: result.cases.length })}</p>
              <ul className="list-disc ms-5">
                {result.cases.map((c) => (
                  <li key={c.id}>
                    <Link className={`${linkClass} break-all`} href={`/moderation/csam/${encodeURIComponent(c.id)}`}><bdi dir="ltr">{c.matchedUrl}</bdi></Link>
                    {c.status === 'unmapped' && <span className="text-danger-fg"> · {t('csamPage.intake.unmapped')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.existing.length > 0 && <p className="text-fg-muted">{t('csamPage.intake.existing', { count: result.existing.length })}</p>}
          {result.notOurs > 0 && <p className="text-fg-muted">{t('csamPage.intake.notOurs', { count: result.notOurs })}</p>}
        </div>
      )}
    </section>
  );
}

export function SettingsCard({ settings }: { settings: CsamSettings }) {
  const { t } = useLanguage();
  const id = useId();
  const retention = useContentAction();
  const webhook = useContentAction();
  const [secret, setSecret] = useState<{ secret: string; webhookUrl: string } | null>(null);

  async function saveRetention(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const days = Number(new FormData(e.currentTarget).get('retentionDays'));
    await retention.run('retention', () => setCsamRetentionDays(days), { success: t('csamPage.settings.saved') });
  }

  const webhookUrl = secret?.webhookUrl ?? settings.webhookUrl;

  return (
    <section className={cardClass} aria-labelledby={`${id}-title`} data-testid="csam-settings">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-3">{t('csamPage.settings.title')}</h2>

      <form onSubmit={saveRetention} className="mb-6 max-w-xl">
        <label htmlFor={`${id}-days`} className={labelClass}>{t('csamPage.settings.retentionLabel')}</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`${id}-days`}
            name="retentionDays"
            type="number"
            required
            min={CSAM_RETENTION_MIN_DAYS}
            max={CSAM_RETENTION_MAX_DAYS}
            step={1}
            defaultValue={settings.retentionDays}
            className={`${fieldClass} w-32`}
            aria-describedby={`${id}-days-note`}
            data-testid="csam-retention-days"
          />
          <button type="submit" className={smallButtonClass} disabled={retention.busy !== null} data-testid="csam-retention-save">
            {retention.busy ? t('content.working') : t('common.save')}
          </button>
        </div>
        <p id={`${id}-days-note`} className="text-sm text-fg-muted mt-1">
          {t('csamPage.settings.retentionNote', { min: CSAM_RETENTION_MIN_DAYS, max: CSAM_RETENTION_MAX_DAYS })}
        </p>
        <ActionFeedback error={retention.error} message={retention.message} testId="csam-retention-feedback" />
      </form>

      <div className="max-w-2xl" data-testid="csam-webhook">
        <h3 className="font-semibold text-fg mb-1">{t('csamPage.settings.webhookTitle')}</h3>
        <p className="text-sm text-fg-muted mb-2">{t('csamPage.settings.webhookNote')}</p>
        <p className="text-sm mb-2" data-testid="csam-webhook-state" data-configured={settings.webhookConfigured || secret ? 'true' : 'false'}>
          {settings.webhookConfigured || secret ? t('csamPage.settings.webhookConfigured') : t('csamPage.settings.webhookNotConfigured')}
        </p>
        {webhookUrl && (
          <div className="mb-3">
            <label htmlFor={`${id}-url`} className={labelClass}>{t('csamPage.settings.webhookUrl')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id={`${id}-url`} readOnly value={webhookUrl} dir="ltr" className={`${fieldClass} flex-1 min-w-0 font-mono text-sm`} data-testid="csam-webhook-url" />
              <CopyButton value={webhookUrl} fallbackId={`${id}-url`} testId="csam-webhook-url-copy" />
            </div>
          </div>
        )}
        {secret && (
          <div className="mb-3 rounded border border-danger-border bg-danger-bg p-3" data-testid="csam-webhook-secret">
            <label htmlFor={`${id}-secret`} className="block text-sm font-medium text-danger-fg mb-1">{t('csamPage.settings.secretShownOnce')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id={`${id}-secret`} readOnly value={secret.secret} dir="ltr" className={`${fieldClass} flex-1 min-w-0 font-mono text-sm`} data-testid="csam-webhook-secret-value" />
              <CopyButton value={secret.secret} fallbackId={`${id}-secret`} testId="csam-webhook-secret-copy" />
            </div>
          </div>
        )}
        <ConfirmButton
          label={settings.webhookConfigured || secret ? t('csamPage.settings.regenerate') : t('csamPage.settings.generate')}
          busy={webhook.busy !== null}
          title={t('csamPage.settings.generateConfirmTitle')}
          body={t(settings.webhookConfigured || secret ? 'csamPage.settings.regenerateConfirmBody' : 'csamPage.settings.generateConfirmBody')}
          confirmLabel={t('csamPage.settings.generate')}
          testId="csam-webhook-generate"
          onConfirm={async () => {
            const out = await webhook.run('webhook', () => generateCsamWebhookSecret(), { refresh: false });
            if (out) setSecret(out);
          }}
        />
        <ActionFeedback error={webhook.error} message={null} testId="csam-webhook-feedback" />
      </div>
    </section>
  );
}
