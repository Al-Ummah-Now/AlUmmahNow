'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { YoutubeImportSettingsView } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import {
  clientIdError,
  clientSecretError,
  formOf,
  readiness,
  switchOf,
  saveErrorMessage,
  scopePurpose,
  secretChecksOnBlur,
  urlSegments,
  secretNameFor,
  secretSaveErrorMessage,
  settingsPatch,
  type YoutubeImportForm,
  type YoutubeImportPatch,
  type YoutubeImportReadiness,
} from '@/lib/youtube-import';
import { useLanguage } from '@/i18n/I18nProvider';
import { type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { Chip, type ChipTone } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { FeatureStatusLine } from '@/components/features/FeatureStatusLine';
import type { FeatureItem } from '@/lib/api/features';

import { LocalTime } from '@/components/LocalTime';
import { HelpTip, SettingLabel } from '@/components/help/HelpTip';
const BADGE: Record<YoutubeImportReadiness, { tone: ChipTone; label: MessageKey }> = {
  ready: { tone: 'good', label: 'youtubeImport.badgeReady' },
  off: { tone: 'neutral', label: 'youtubeImport.badgeOff' },
  needsClientId: { tone: 'warn', label: 'youtubeImport.badgeNeedsClientId' },
  needsSecret: { tone: 'warn', label: 'youtubeImport.badgeNeedsSecret' },
};

/** A URL, left to right, that wraps only after a "/" (copying it gives the exact URL). */
function Url({ url, testId }: { url: string; testId?: string }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg [overflow-wrap:normal]" dir="ltr" data-testid={testId}>
      {urlSegments(url).map((part, i) => (
        <span key={i}>
          {i > 0 && <wbr />}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </code>
  );
}

const STEPS: MessageKey[] = [
  'youtubeImport.step1',
  'youtubeImport.step2',
  'youtubeImport.step3',
  'youtubeImport.step4',
  'youtubeImport.step5',
  'youtubeImport.step6',
  'youtubeImport.step7',
];

type SaveAction<A> = (arg: A) => Promise<ActionResult<YoutubeImportSettingsView>>;

/**
 * Move from YouTube (wiki AUN-YT-IMPORT): turn creators' imports on, set the Google OAuth client id,
 * and set the client secret (write only: typed once, sealed by api-videos, never shown again).
 * Saved through admin-api (media:manage), audited. `save` and `saveSecret` are the
 * saveYoutubeImportSettings / saveYoutubeImportClientSecret server actions, passed in by the page.
 */
export function YoutubeImportSetting({
  view,
  canEdit,
  save: saveSettings,
  saveSecret,
  feature,
}: {
  view: YoutubeImportSettingsView;
  canEdit: boolean;
  /** The "Move from YouTube" switch (Features page) */
  feature?: Pick<FeatureItem, 'effective' | 'enabled'> | null;
  save: SaveAction<YoutubeImportPatch>;
  saveSecret: SaveAction<string>;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [form, setForm] = useState<YoutubeImportForm>(formOf(view));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The secret editor: the typed value lives only here until it is sent, and is cleared right after
  const [editingSecret, setEditingSecret] = useState(false);
  const [secretValue, setSecretValue] = useState('');
  const [secretTouched, setSecretTouched] = useState(false);
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretError, setSecretError] = useState<string | null>(null);
  const secretFieldError = secretTouched ? clientSecretError(secretValue) : null;
  const on = switchOf(view, feature);
  const fieldError = clientIdError({ ...form, enabled: on.stored });
  const shownError = touched ? fieldError : null;
  const patch = settingsPatch(view, form);
  const state = readiness({ ...view, enabled: on.effective });
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

  function closeSecretEditor() {
    setEditingSecret(false);
    setSecretValue('');
    setSecretTouched(false);
    setSecretError(null);
  }

  async function submitSecret() {
    setSecretTouched(true);
    if (!canEdit || secretBusy || clientSecretError(secretValue)) return;
    setSecretBusy(true);
    setSecretError(null);
    setNotice(null);
    try {
      const result = await saveSecret(secretValue);
      if (!result.ok) {
        logger.warn('[platform-settings] YouTube import client secret save failed', { status: result.status });
        if (result.status === 0 || result.status >= 500) reportError(new Error(`YouTube import client secret save failed: ${result.status}`), { kind: 'fetch', status: result.status, shown: true });
        setSecretError(t(secretSaveErrorMessage(result)));
        return;
      }
      closeSecretEditor();
      setNotice(t('youtubeImport.secretSaved'));
      router.refresh();
    } catch (e) {
      logger.error('[platform-settings] YouTube import client secret request failed', { error: e instanceof Error ? e.message : String(e) });
      reportError(e, { kind: 'fetch', shown: true });
      setSecretError(t('youtubeImport.secretSaveFailed'));
    } finally {
      setSecretBusy(false);
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
          <FeatureStatusLine featureKey="youtubeImport" item={feature} className="rounded border border-border p-3" />

          <div className="flex flex-col gap-1 max-w-2xl">
            <SettingLabel htmlFor={`${ids}-client-id`} helpId="platform.youtubeImport.clientId" className={term}>
              {t('youtubeImport.clientId')}
            </SettingLabel>
            <input
              id={`${ids}-client-id`}
              data-help="platform.youtubeImport.clientId"
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
          </div>
        </fieldset>

        <dl className="grid gap-4 md:grid-cols-2">
          <div
            className="rounded border border-border p-3"
            data-testid="youtube-import-secret"
            data-present={view.secretPresent ? 'true' : 'false'}
            data-source={view.secretSource ?? 'none'}
          >
            <dt className={`${term} flex flex-wrap items-center gap-2`}>
              <span className="inline-flex items-center">
                {t('youtubeImport.secret')}
                <HelpTip id="platform.youtubeImport.clientSecret" />
              </span>
              <Chip tone={view.secretPresent ? 'good' : 'warn'} testId="youtube-import-secret-state">
                {view.secretPresent ? t('youtubeImport.secretPresent') : t('youtubeImport.secretMissing')}
              </Chip>
            </dt>
            <dd className={`${detail} mt-1`} data-testid="youtube-import-secret-detail">
              {view.secretSource === 'admin' ? (
                view.secretUpdatedAt ? (
                  // People by name, never their id (owner rule)
                  fillNodes(t('youtubeImport.secretSetHere'), { date: <LocalTime value={view.secretUpdatedAt} withTime />,
                    actor: view.secretUpdatedBy ? <UserName id={view.secretUpdatedBy} showEmail={false} /> : '—',
                  })
                ) : (
                  t('youtubeImport.secretSetHereUndated')
                )
              ) : view.secretSource === 'binding' ? (
                <>
                  {t('youtubeImport.secretFromStore')}
                  <code className="mx-1 inline-block whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg" dir="ltr">{secretName}</code>
                </>
              ) : (
                t('youtubeImport.secretMissingHint')
              )}
            </dd>
            {view.secretUnreadable && (
              <dd className="mt-2 text-sm text-warning-fg" data-testid="youtube-import-secret-unreadable">{t('youtubeImport.secretUnreadable')}</dd>
            )}
            {canEdit && !editingSecret && (
              <dd className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setEditingSecret(true);
                  }}
                  className={`${secondaryButtonClass} !py-1 !px-3 text-sm`}
                  data-testid="youtube-import-secret-replace"
                >
                  {view.secretPresent ? t('youtubeImport.secretReplace') : t('youtubeImport.secretAdd')}
                </button>
              </dd>
            )}
            {canEdit && editingSecret && (
              <dd className="mt-3 space-y-2" data-testid="youtube-import-secret-editor">
                <label className="flex flex-col gap-1">
                  <span className={term}>{t('youtubeImport.secretNew')}</span>
                  <input
                    type="password"
                    data-help="platform.youtubeImport.clientSecret"
                    // Uncontrolled: React would mirror a controlled value into the value attribute (page markup)
                    defaultValue=""
                    onChange={(e) => setSecretValue(e.target.value)}
                    onBlur={(e) => setSecretTouched(secretChecksOnBlur(e.currentTarget.value))}
                    onKeyDown={(e) => {
                      // The editor sits inside the settings form: Enter saves the secret, not the settings
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submitSecret();
                      }
                      if (e.key === 'Escape') closeSecretEditor();
                    }}
                    className={`${fieldClass} font-mono text-sm`}
                    dir="ltr"
                    spellCheck={false}
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoFocus
                    disabled={secretBusy}
                    aria-invalid={secretFieldError ? true : undefined}
                    aria-describedby={`${ids}-secret-help${secretFieldError ? ` ${ids}-secret-error` : ''}`}
                    data-testid="youtube-import-secret-input"
                  />
                  <span id={`${ids}-secret-help`} className="text-xs text-fg-muted">
                    {t(view.secretPresent ? 'youtubeImport.secretReplaceHint' : 'youtubeImport.secretAddHint')}
                  </span>
                  {secretFieldError && (
                    <span id={`${ids}-secret-error`} className="text-xs text-danger-fg" data-testid="youtube-import-secret-error">{t(secretFieldError)}</span>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void submitSecret()} className={`${primaryButtonClass} !py-1 !px-3 text-sm`} disabled={secretBusy} data-testid="youtube-import-secret-save">
                    {secretBusy ? t('platformSettings.saving') : t('youtubeImport.secretSave')}
                  </button>
                  <button type="button" onClick={closeSecretEditor} className={`${secondaryButtonClass} !py-1 !px-3 text-sm`} disabled={secretBusy} data-testid="youtube-import-secret-cancel">
                    {t('common.cancel')}
                  </button>
                </div>
                {secretError && <ErrorAlert testId="youtube-import-secret-save-error">{secretError}</ErrorAlert>}
              </dd>
            )}
          </div>
          <div className="rounded border border-border p-3">
            <dt className={term}>{t('youtubeImport.redirectUri')}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              <span className="min-w-0"><Url url={view.redirectUri} testId="youtube-import-redirect-uri" /></span>
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
                <Url url={scope} />
                <span className="block text-fg-muted">{t(scopePurpose(scope))}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-fg-muted" data-testid="youtube-import-last-changed">
          {view.updatedAt
            ? fillNodes(t('platformSettings.lastChanged'), { date: <LocalTime value={view.updatedAt} withTime />,
                actor: view.updatedBy ? <UserName id={view.updatedBy} showEmail={false} /> : '—',
              })
            : t('youtubeImport.neverChanged')}
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
        <ol className={`mt-3 ${locale === 'ar' ? '[list-style-type:arabic-indic]' : 'list-decimal'} space-y-2 ps-5 text-sm text-fg-muted [overflow-wrap:break-word]`}>
          {STEPS.map((step) => (
            <li key={step}>{fillNodes(t(step, { secretName }), { redirectUri: <Url url={view.redirectUri} /> })}</li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-fg-muted">{t('youtubeImport.quota')}</p>
      </details>
    </section>
  );
}
