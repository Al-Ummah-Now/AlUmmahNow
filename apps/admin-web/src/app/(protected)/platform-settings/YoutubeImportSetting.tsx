'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { YoutubeImportSettingsView } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { clientIdError, formOf, readiness, saveErrorMessage, scopePurpose, secretNameFor, settingsPatch, type YoutubeImportForm, type YoutubeImportPatch, type YoutubeImportReadiness } from '@/lib/youtube-import';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { Chip, type ChipTone } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

const BADGE: Record<YoutubeImportReadiness, { tone: ChipTone; label: MessageKey }> = {
  ready: { tone: 'good', label: 'youtubeImport.badgeReady' },
  off: { tone: 'neutral', label: 'youtubeImport.badgeOff' },
  needsClientId: { tone: 'warn', label: 'youtubeImport.badgeNeedsClientId' },
  needsSecret: { tone: 'warn', label: 'youtubeImport.badgeNeedsSecret' },
};

const STEPS: MessageKey[] = [
  'youtubeImport.step1',
  'youtubeImport.step2',
  'youtubeImport.step3',
  'youtubeImport.step4',
  'youtubeImport.step5',
  'youtubeImport.step6',
  'youtubeImport.step7',
];

/**
 * Move from YouTube (wiki AUN-YT-IMPORT): turn creators' imports on, set the Google OAuth client id,
 * and see whether the client secret is in Secrets Store. Saved through admin-api (media:manage), audited.
 * `save` is the saveYoutubeImportSettings server action, passed in by the page (as the tier editor's actions are).
 */
export function YoutubeImportSetting({ view, canEdit, save: saveSettings }: { view: YoutubeImportSettingsView; canEdit: boolean; save: (patch: YoutubeImportPatch) => Promise<ActionResult<YoutubeImportSettingsView>> }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [form, setForm] = useState<YoutubeImportForm>(formOf(view));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fieldError = clientIdError(form);
  const shownError = touched ? fieldError : null;
  const patch = settingsPatch(view, form);
  const state = readiness(view);
  const secretName = secretNameFor(view.redirectUri);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!canEdit || fieldError || !patch) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveSettings(patch);
      if (!result.ok) {
        logger.warn('[platform-settings] YouTube import save failed', { status: result.status });
        if (result.status === 0 || result.status >= 500) reportError(new Error(`YouTube import settings save failed: ${result.status}`), { kind: 'fetch', status: result.status, shown: true });
        setError(t(saveErrorMessage(result)));
        return;
      }
      setNotice(t('youtubeImport.saved'));
      setTouched(false);
      router.refresh();
    } catch (e) {
      logger.error('[platform-settings] YouTube import save request failed', { error: e instanceof Error ? e.message : String(e) });
      reportError(e, { kind: 'fetch', shown: true });
      setError(t('youtubeImport.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(view.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      logger.warn('[platform-settings] Could not copy the redirect URI', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const term = 'text-sm font-medium text-fg';
  const detail = 'text-sm text-fg-muted';

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${ids}-title`} data-testid="youtube-import-setting" data-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg">{t('youtubeImport.title')}</h2>
        <Chip tone={BADGE[state].tone} large testId="youtube-import-badge">{t(BADGE[state].label)}</Chip>
      </div>
      <p className={`${detail} mb-5 max-w-3xl`}>{t('youtubeImport.intro')}</p>

      <form onSubmit={save} className="space-y-5" noValidate>
        <fieldset disabled={!canEdit || busy} className="space-y-5">
          <label className="flex items-start gap-3 rounded border border-border p-3 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-surface-2">
            <input
              type="checkbox"
              role="switch"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              aria-describedby={`${ids}-enabled-hint`}
              data-testid="youtube-import-enabled"
            />
            <span>
              <span className="block text-fg font-medium">{t('youtubeImport.enabled')}</span>
              <span id={`${ids}-enabled-hint`} className="block text-sm text-fg-muted">{t('youtubeImport.enabledHint')}</span>
            </span>
          </label>

          <label className="flex flex-col gap-1 max-w-2xl">
            <span className={term}>{t('youtubeImport.clientId')}</span>
            <input
              value={form.clientId}
              onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              onBlur={() => setTouched(true)}
              className={`${fieldClass} font-mono text-sm`}
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
              placeholder="123456789012-abc123def456.apps.googleusercontent.com"
              aria-invalid={shownError ? true : undefined}
              aria-describedby={`${ids}-client-help${shownError ? ` ${ids}-client-error` : ''}`}
              data-testid="youtube-import-client-id"
            />
            <span id={`${ids}-client-help`} className="text-xs text-fg-muted">{t('youtubeImport.clientIdHint')}</span>
            {shownError && (
              <span id={`${ids}-client-error`} className="text-xs text-danger-fg" data-testid="youtube-import-client-id-error">{t(shownError)}</span>
            )}
          </label>
        </fieldset>

        <dl className="grid gap-4 md:grid-cols-2">
          <div className="rounded border border-border p-3" data-testid="youtube-import-secret" data-present={view.secretPresent ? 'true' : 'false'}>
            <dt className={`${term} flex flex-wrap items-center gap-2`}>
              {t('youtubeImport.secret')}
              <Chip tone={view.secretPresent ? 'good' : 'warn'}>{view.secretPresent ? t('youtubeImport.secretPresent') : t('youtubeImport.secretMissing')}</Chip>
            </dt>
            <dd className={`${detail} mt-1`}>
              {t(view.secretPresent ? 'youtubeImport.secretPresentHint' : 'youtubeImport.secretMissingHint')}
              <code className="mx-1 inline-block whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg" dir="ltr">{secretName}</code>
            </dd>
          </div>
          <div className="rounded border border-border p-3">
            <dt className={term}>{t('youtubeImport.redirectUri')}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg" dir="ltr" data-testid="youtube-import-redirect-uri">{view.redirectUri}</code>
              <button type="button" onClick={copyRedirect} className={`${secondaryButtonClass} !py-1 !px-3 text-sm`} data-testid="youtube-import-copy-redirect">
                {copied ? t('youtubeImport.copied') : t('youtubeImport.copy')}
              </button>
            </dd>
            <dd className="text-xs text-fg-muted mt-1">{t('youtubeImport.redirectUriHint')}</dd>
          </div>
        </dl>

        <div>
          <h3 className={`${term} mb-2`}>{t('youtubeImport.scopes')}</h3>
          <ul className="space-y-2" data-testid="youtube-import-scopes">
            {view.scopes.map((scope) => (
              <li key={scope} className="text-sm">
                <code className="break-all font-mono text-xs text-fg" dir="ltr">{scope}</code>
                <span className="block text-fg-muted">{t(scopePurpose(scope))}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-fg-muted" data-testid="youtube-import-last-changed">
          {view.updatedAt ? t('platformSettings.lastChanged', { date: formatDate(view.updatedAt, locale, true), actor: view.updatedBy ?? '—' }) : t('youtubeImport.neverChanged')}
        </p>

        {canEdit ? (
          <button type="submit" className={primaryButtonClass} disabled={busy || !patch} data-testid="youtube-import-save">
            {busy ? t('platformSettings.saving') : t('platformSettings.save')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="youtube-import-read-only">{t('youtubeImport.readOnly')}</p>
        )}
        {error && <ErrorAlert testId="youtube-import-save-error">{error}</ErrorAlert>}
        <p role="status" className="text-sm text-fg" data-testid="youtube-import-saved">{notice}</p>
      </form>

      <details className="mt-6 rounded border border-border p-3" data-testid="youtube-import-setup">
        <summary className="cursor-pointer text-sm font-medium text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">{t('youtubeImport.setupTitle')}</summary>
        <ol className="mt-3 list-decimal space-y-2 ps-5 text-sm text-fg-muted [overflow-wrap:anywhere]">
          {STEPS.map((step) => (
            <li key={step}>{t(step, { redirectUri: view.redirectUri, secretName })}</li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-fg-muted">{t('youtubeImport.quota')}</p>
      </details>
    </section>
  );
}
