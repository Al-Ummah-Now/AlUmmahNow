'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlatformCredentialTest, PlatformCredentialView } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { CHECK_COPY, createErrorKey, credentialState, previousTokenNotice, saveErrorKey, testSummary, tokenError, type CredentialState } from '@/lib/platform-credentials';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { Chip, type ChipTone } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

type Change = { view: PlatformCredentialView; test: PlatformCredentialTest };
type ReplaceAction = (id: string, value: string) => Promise<ActionResult<Change>>;
type TestAction = (id: string) => Promise<ActionResult<Change>>;
type CreateAction = (id: string) => Promise<ActionResult<Change & { previousRevoked: boolean; previousKept: 'none' | 'not_minted_here' | 'revoke_failed' | null }>>;

const STATE: Record<CredentialState, { tone: ChipTone; label: MessageKey }> = {
  ok: { tone: 'good', label: 'platformCredentials.stateOk' },
  attention: { tone: 'warn', label: 'platformCredentials.stateAttention' },
  untested: { tone: 'neutral', label: 'platformCredentials.stateUntested' },
  missing: { tone: 'warn', label: 'platformCredentials.stateMissing' },
};

const TITLE: Record<string, { title: MessageKey; purpose: MessageKey }> = {
  'cloudflare-media': { title: 'platformCredentials.cloudflareMediaTitle', purpose: 'platformCredentials.cloudflareMediaPurpose' },
  'cloudflare-token-manager': { title: 'platformCredentials.tokenManagerTitle', purpose: 'platformCredentials.tokenManagerPurpose' },
};

/**
 * Platform settings → Credentials (Super Admin): each platform credential's source and last test,
 * with Create / Rotate (the token manager mints a token with only the permissions it needs, tests it,
 * stores it and revokes the previous one if it was minted here), Replace (write only: typed once,
 * never shown again) and Test (each missing Cloudflare permission named in plain words). All audited.
 */
export function PlatformCredentialsSetting({ views, replace, test, create }: { views: PlatformCredentialView[]; replace: ReplaceAction; test: TestAction; create: CreateAction }) {
  const { t } = useLanguage();
  const ids = useId();
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${ids}-title`} data-testid="platform-credentials">
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-2">{t('platformCredentials.title')}</h2>
      <p className="text-sm text-fg-muted mb-5 max-w-3xl">{t('platformCredentials.intro')}</p>
      <div className="space-y-4">
        {views.map((view) => (
          <CredentialItem key={view.id} initial={view} replace={replace} test={test} create={create} />
        ))}
      </div>
    </section>
  );
}

function CredentialItem({ initial, replace, test: runTest, create }: { initial: PlatformCredentialView; replace: ReplaceAction; test: TestAction; create: CreateAction }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState(false);
  // The typed value lives only here until it is sent, and is dropped right after
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fieldError = touched ? tokenError(value) : null;
  const state = credentialState(view);
  const copy = TITLE[view.id] ?? { title: 'platformCredentials.title', purpose: 'platformCredentials.intro' };
  const term = 'text-sm font-medium text-fg';

  function close() {
    setEditing(false);
    setValue('');
    setTouched(false);
    setError(null);
  }

  function failed(kind: 'save' | 'test' | 'create', result: { status: number; error?: string }) {
    logger.warn(`[platform-settings] Credential ${kind} failed`, { id: view.id, status: result.status });
    if (result.status === 0 || result.status >= 500) reportError(new Error(`Platform credential ${kind} failed: ${result.status}`), { kind: 'fetch', status: result.status, shown: true });
  }

  async function save() {
    setTouched(true);
    if (busy || tokenError(value)) return;
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const result = await replace(view.id, value.trim());
      if (!result.ok) {
        failed('save', result);
        setError(t(saveErrorKey(result.status, result.error)));
        return;
      }
      setView(result.data.view);
      close();
      setNotice(t('platformCredentials.saved'));
      router.refresh();
    } catch (e) {
      logger.error('[platform-settings] Credential save request failed', { id: view.id, error: e instanceof Error ? e.message : String(e) });
      reportError(e, { shown: true });
      setError(t('platformCredentials.errorFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (busy) return;
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const result = await runTest(view.id);
      if (!result.ok) {
        failed('test', result);
        setError(t(result.status === 403 ? 'platformCredentials.errorForbidden' : 'platformCredentials.testFailed'));
        return;
      }
      setView(result.data.view);
      setNotice(t('platformCredentials.tested'));
    } catch (e) {
      logger.error('[platform-settings] Credential test request failed', { id: view.id, error: e instanceof Error ? e.message : String(e) });
      reportError(e, { shown: true });
      setError(t('platformCredentials.testFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function mint() {
    if (busy) return;
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      const result = await create(view.id);
      if (!result.ok) {
        failed('create', result);
        setError(t(createErrorKey(result.status, result.code)));
        return;
      }
      setView(result.data.view);
      setNotice(t(previousTokenNotice(result.data.previousRevoked, result.data.previousKept)));
      router.refresh();
    } catch (e) {
      logger.error('[platform-settings] Credential create request failed', { id: view.id, error: e instanceof Error ? e.message : String(e) });
      reportError(e, { shown: true });
      setError(t('platformCredentials.errorCreateFailed'));
    } finally {
      setBusy(null);
    }
  }

  const failedChecks = view.test?.checks.filter((c) => !c.ok) ?? [];

  return (
    <article className="rounded border border-border p-4" aria-labelledby={`${ids}-name`} data-testid={`credential-${view.id}`} data-state={state} data-source={view.source ?? 'none'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${ids}-name`} className="text-base font-semibold text-fg">{t(copy.title)}</h3>
        <Chip tone={STATE[state].tone} large testId={`credential-${view.id}-state`}>{t(STATE[state].label)}</Chip>
      </div>
      <p className="mt-1 text-sm text-fg-muted max-w-3xl">{t(copy.purpose)}</p>

      <p className="mt-3 text-sm text-fg" data-testid={`credential-${view.id}-source`}>
        {view.source === 'admin' ? (
          t('platformCredentials.sourceAdmin', {
            date: view.updatedAt ? formatDate(view.updatedAt, locale, true) : '—',
            actor: view.updatedByName || view.updatedBy || '—',
            last4: `…${view.last4 ?? ''}`,
          })
        ) : view.source === 'binding' ? (
          <>
            {t('platformCredentials.sourceBinding')}
            <code className="mx-1 inline-block whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg" dir="ltr">{view.secretsStoreName}</code>
          </>
        ) : (
          t('platformCredentials.sourceNone')
        )}
      </p>
      {view.minted && (
        <p className="mt-1 text-sm text-fg-muted" data-testid={`credential-${view.id}-minted`}>
          {t('platformCredentials.mintedHere', { date: formatDate(view.minted.at, locale, true), actor: view.minted.byName || view.minted.by })}
        </p>
      )}
      {view.unreadable && (
        <p className="mt-2 text-sm text-warning-fg" data-testid={`credential-${view.id}-unreadable`}>{t('platformCredentials.unreadable')}</p>
      )}
      <p className="mt-1 text-xs text-fg-muted">{t('platformCredentials.sharedEntry')}</p>
      <p className="mt-1 text-xs text-fg-muted">
        {t('platformCredentials.usedBy')}{' '}
        {view.usedBy.map((u, i) => (
          <span key={`${u.worker}-${u.binding}`}>
            {i > 0 && ', '}
            <code className="font-mono" dir="ltr">{`${u.worker} ${u.binding}`}</code>
          </span>
        ))}
      </p>

      <div className="mt-4 rounded bg-surface-2 p-3" data-testid={`credential-${view.id}-test`} data-code={view.test?.code ?? 'never'}>
        {view.test ? (
          <>
            <p className="text-xs text-fg-muted">{t('platformCredentials.lastTest', { date: formatDate(view.test.at, locale, true) })}</p>
            <p className={`mt-1 text-sm font-medium ${view.test.ok ? 'text-success-fg' : 'text-warning-fg'}`}>{t(testSummary(view.test.code))}</p>
            {view.test.checks.length > 0 && (
              <ul className="mt-2 space-y-2" aria-label={t('platformCredentials.test')}>
                {view.test.checks.map((check) => (
                  <li key={check.name} className="text-sm" data-testid={`credential-check-${check.name}`} data-ok={check.ok ? 'true' : 'false'}>
                    <span className={`me-2 inline-block w-4 font-bold ${check.ok ? 'text-success-fg' : 'text-danger-fg'}`} aria-hidden="true">{check.ok ? '✓' : '✕'}</span>
                    <span className="text-fg">{t(CHECK_COPY[check.name].label)}</span>
                    {!check.ok && failedChecks.length > 0 && (
                      <span className="mt-0.5 block ps-6 text-fg-muted">
                        {t(CHECK_COPY[check.name].permission)} {t(CHECK_COPY[check.name].impact)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-fg-muted">{t('platformCredentials.neverTested')}</p>
        )}
      </div>

      {!editing && view.mintable && (
        <p className="mt-4 text-sm text-fg-muted" data-testid={`credential-${view.id}-create-hint`}>
          {t(view.canMint ? 'platformCredentials.createHint' : 'platformCredentials.needsManager')}
        </p>
      )}
      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          {view.mintable && view.canMint && (
            <button type="button" onClick={() => void mint()} className={`${primaryButtonClass} !py-1 !px-3 text-sm`} disabled={!!busy} data-testid={`credential-${view.id}-create`}>
              {busy === 'create' ? t('platformCredentials.creating') : view.present ? t('platformCredentials.rotate') : t('platformCredentials.create')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setEditing(true);
            }}
            className={`${secondaryButtonClass} !py-1 !px-3 text-sm`}
            disabled={!!busy}
            data-testid={`credential-${view.id}-replace`}
          >
            {view.source === 'admin' || view.source === 'binding' ? t('platformCredentials.replace') : t('platformCredentials.add')}
          </button>
          <button type="button" onClick={() => void test()} className={`${secondaryButtonClass} !py-1 !px-3 text-sm`} disabled={!!busy || !view.present} data-testid={`credential-${view.id}-run-test`}>
            {busy === 'test' ? t('platformCredentials.testing') : t('platformCredentials.test')}
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-4 space-y-2" data-testid={`credential-${view.id}-editor`}>
          <label className="flex flex-col gap-1 max-w-xl">
            <span className={term}>{t('platformCredentials.newValue')}</span>
            <input
              type="password"
              // Uncontrolled: React would mirror a controlled value into the value attribute (page markup)
              defaultValue=""
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') close();
              }}
              className={`${fieldClass} font-mono text-sm`}
              dir="ltr"
              spellCheck={false}
              autoComplete="new-password"
              autoCapitalize="off"
              autoFocus
              disabled={!!busy}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={`${ids}-help${fieldError ? ` ${ids}-error` : ''}`}
              data-testid={`credential-${view.id}-input`}
            />
            <span id={`${ids}-help`} className="text-xs text-fg-muted">{t('platformCredentials.newValueHint')}</span>
            {fieldError && (
              <span id={`${ids}-error`} className="text-xs text-danger-fg" data-testid={`credential-${view.id}-error`}>{t(fieldError)}</span>
            )}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void save()} className={`${primaryButtonClass} !py-1 !px-3 text-sm`} disabled={!!busy} data-testid={`credential-${view.id}-save`}>
              {busy === 'save' ? t('platformCredentials.saving') : t('platformCredentials.save')}
            </button>
            <button type="button" onClick={close} className={`${secondaryButtonClass} !py-1 !px-3 text-sm`} disabled={!!busy} data-testid={`credential-${view.id}-cancel`}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {error && <ErrorAlert testId={`credential-${view.id}-save-error`}>{error}</ErrorAlert>}
      <p role="status" className="mt-2 text-sm text-fg" data-testid={`credential-${view.id}-notice`}>{notice}</p>
    </article>
  );
}
