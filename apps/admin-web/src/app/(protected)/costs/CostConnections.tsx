'use client';

/**
 * Costs → Connections (super admins, ops:manage): the read-only Cloudflare token the collector
 * needs and the optional Bunny and Resend keys. A key is typed once, sent to admin-api (which
 * seals and tests it) and cleared from the field: it is never pre-filled, echoed, kept in state
 * after the save or logged. The page shows only its last four characters, who set it and when,
 * and the last test, translated by its code.
 */
import { useId, useState } from 'react';
import type { CostCredentialView, CostProvider } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ConfirmButton } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { fieldClass } from '@/components/ui';
import { removeCostCredential, saveCostCredential, testCostCredential } from '@/lib/api/costs';
import type { CostTestResult } from '@/lib/api/costs-types';
import { connectionActions, connectionStatus, credentialState, keyProblem, missingListings, testCodeOf, type CredentialState, type KeyProblem } from './model';
import { FeedbackLine, useCostAction } from './useCostAction';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { LocalTime } from '@/components/LocalTime';

const PROVIDERS: CostProvider[] = ['cloudflare', 'bunny', 'resend'];
const STATE_TONE: Record<CredentialState, 'good' | 'warn' | 'bad'> = { set: 'good', unset: 'warn', unreadable: 'bad' };
const STATE_DOT: Record<CredentialState, string> = { set: 'text-success-fg', unset: 'text-fg-muted', unreadable: 'text-danger-fg' };

function ProviderMark({ provider }: { provider: CostProvider }) {
  const path =
    provider === 'cloudflare'
      ? 'M6.5 17h11a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.3 9.2 4 4 0 0 0 6.5 17z'
      : provider === 'bunny'
        ? 'M5 4h14v16H5zM5 9h14M5 15h14M9 4v16M15 4v16'
        : 'M3 6h18v12H3zM3 7l9 6 9-6';
  return (
    <span aria-hidden="true" className="cost-tile inline-flex size-10 shrink-0 items-center justify-center text-fg">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </span>
  );
}

function ConnectionCard({ view, releaseInUse = false }: { view: CostCredentialView; releaseInUse?: boolean }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const p = view.provider;
  const name = t(`costs.connections.providers.${p}`);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<KeyProblem | null>(null);
  const [fresh, setFresh] = useState<CostTestResult | null>(null);
  const { run, busy, feedback } = useCostAction(`connection:${p}`);
  const state = credentialState(view);

  const code = testCodeOf(fresh?.code ?? view.test?.code ?? view.test?.message);
  const testOk = fresh?.ok ?? view.test?.ok ?? false;
  const testLine = view.test || fresh ? (code ? t(`costs.connections.tests.${code}` as `costs.connections.tests.cf_ok`) : testOk ? t('costs.connections.tests.unknownOk') : t('costs.connections.tests.unknown')) : null;
  // Works, but the collector misses some listings: a warning, not a pass
  const partial = code === 'cf_partial';
  const missing = partial ? missingListings(fresh?.checks ?? view.test?.checks) : [];

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const issue = keyProblem(p, value);
    setProblem(issue);
    if (issue) return;
    const key = value;
    const out = await run('save', () => saveCostCredential(p, key), () => t('costs.connections.saved'));
    if (out) {
      setValue('');
      setFresh(out.test);
    }
  }

  async function retest() {
    const out = await run('test', () => testCostCredential(p), () => t('costs.connections.tested'));
    if (out) setFresh(out.test);
  }

  const status = connectionStatus(p, state, view.last4, releaseInUse);
  const statusText = status === 'set' ? t('costs.connections.status.set', { last4: view.last4 ?? '' }) : t(`costs.connections.status.${status}`);
  // Who set it, by name (never the raw id): the stored name, else the names lookup
  const who: React.ReactNode = view.updatedByName || (view.updatedBy ? <UserName id={view.updatedBy} showEmail={false} /> : null);

  return (
    <article className="cost-panel flex min-w-0 flex-col p-5" aria-labelledby={`${ids}-title`} data-testid={`costs-connection-${p}`} data-state={state}>
      <div className="flex items-start gap-3">
        <ProviderMark provider={p} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${ids}-title`} className="text-base font-semibold text-fg">{name}</h3>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted">{p === 'cloudflare' ? t('costs.connections.required') : t('costs.connections.optional')}</span>
          </div>
          <p className="cost-pill cost-pill-wrap mt-2" data-tone={p === 'cloudflare' || state !== 'unset' ? STATE_TONE[state] : undefined} data-testid={`costs-connection-${p}-status`}>
            <span aria-hidden="true" className={`cost-dot ${STATE_DOT[state]}`} />
            <span dir="auto">{statusText}</span>
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm text-fg-muted">{t(`costs.connections.about.${p}`)}</p>

      {((view.set && view.updatedAt) || testLine) && (
        <div className="cost-tile mt-3 space-y-1.5 p-3 text-xs">
          {/* Only a key that is set has a "set by" (a removed key keeps no author) */}
          {view.set && view.updatedAt && (
            <p className="text-fg-muted" data-testid={`costs-connection-${p}-set-by`}>
              {fillNodes(t(who ? 'costs.connections.setBy' : 'costs.connections.setAt'), { time: <LocalTime value={view.updatedAt} withTime />, ...(who ? { name: who } : {}) })}
            </p>
          )}
          {testLine && (
            <div data-testid={`costs-connection-${p}-test-result`} data-ok={testOk ? 'true' : 'false'} data-code={code ?? ''}>
              <p className="text-fg-muted">{view.test ? fillNodes(t('costs.connections.lastTest'), { time: <LocalTime value={view.test.at} withTime /> }) : t('costs.connections.neverTested')}</p>
              <p className={`mt-0.5 flex items-start gap-1.5 text-sm ${partial ? 'text-warning-fg' : testOk ? 'text-success-fg' : 'text-danger-fg'}`}>
                <span aria-hidden="true">{partial ? '!' : testOk ? '✓' : '✕'}</span>
                <span>{testLine}</span>
              </p>
              {missing.length > 0 && (
                <p className="mt-1 text-fg" data-testid={`costs-connection-${p}-missing`}>
                  {t('costs.connections.missing', { list: missing.map((m) => t(`costs.connections.listings.${m}`)).join(locale === 'ar' ? '، ' : ', ') })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {!view.test && !fresh && state !== 'unset' && <p className="mt-2 text-xs text-fg-muted">{t('costs.connections.neverTested')}</p>}

      <div className="mt-4 flex flex-1 flex-col gap-3">
        {/* Only the key field is the form: Remove's confirm dialog has a form of its own */}
        <form id={`${ids}-form`} onSubmit={save} noValidate data-testid={`costs-connection-${p}-form`}>
          <label htmlFor={`${ids}-key`} className="block text-sm font-medium text-fg">{t('costs.connections.keyLabel', { provider: name })}</label>
          <input
            id={`${ids}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            dir="ltr"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (problem) setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${ids}-help${problem ? ` ${ids}-error` : ''}`}
            className={`${fieldClass} mt-1 w-full font-mono ${problem ? 'border-danger-border' : ''}`}
            data-testid={`costs-connection-${p}-input`}
          />
          <span id={`${ids}-help`} className="mt-1 block text-xs text-fg-muted">{t('costs.connections.keyHelp')}</span>
          {problem && (
            <span id={`${ids}-error`} className="mt-1 block text-xs text-danger-fg" data-testid={`costs-connection-${p}-key-error`}>
              {t(`costs.connections.keyErrors.${problem}`)}
            </span>
          )}
        </form>
        <div className="mt-auto flex flex-wrap gap-2">
          <button
            type="submit"
            form={`${ids}-form`}
            className="cost-primary inline-flex min-h-10 items-center justify-center rounded px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy !== null || value.trim() === ''}
            data-testid={`costs-connection-${p}-save`}
          >
            {busy === 'save' ? t('content.working') : t('costs.connections.save')}
          </button>
          {connectionActions(state) && (
            <>
              <button type="button" className={`${smallButtonClass} min-h-10`} disabled={busy !== null} onClick={retest} data-testid={`costs-connection-${p}-test`}>
                {busy === 'test' ? t('content.working') : t('costs.connections.test')}
              </button>
              <ConfirmButton
                label={t('costs.connections.remove')}
                title={t('costs.connections.removeTitle', { provider: name })}
                body={t('costs.connections.removeBody', { provider: name })}
                confirmLabel={t('costs.connections.remove')}
                danger
                busy={busy === 'remove'}
                buttonClassName="min-h-10"
                testId={`costs-connection-${p}-remove`}
                onConfirm={async () => {
                  const out = await run('remove', () => removeCostCredential(p), () => t('costs.connections.removed'));
                  if (out) setFresh(null);
                }}
              />
            </>
          )}
        </div>
        <FeedbackLine feedback={feedback} testId={`costs-connection-${p}-feedback`} />
      </div>
    </article>
  );
}

export function CostConnections({ connections, releaseInUse = false }: { connections: CostCredentialView[]; releaseInUse?: boolean }) {
  const { t } = useLanguage();
  const views = PROVIDERS.map((p) => connections.find((c) => c.provider === p) ?? { provider: p, set: false, last4: null, updatedBy: null, updatedByName: null, updatedAt: null, test: null });
  return (
    <section id="connections" className="scroll-mt-24" aria-labelledby="costs-connections-title" data-testid="costs-connections">
      <h2 id="costs-connections-title" className="text-lg font-semibold text-fg">{t('costs.connections.title')}</h2>
      <p className="mb-4 mt-1 max-w-3xl text-sm text-fg-muted">{t('costs.connections.note')}</p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {views.map((v) => <ConnectionCard key={v.provider} view={v} releaseInUse={releaseInUse} />)}
      </div>
    </section>
  );
}
