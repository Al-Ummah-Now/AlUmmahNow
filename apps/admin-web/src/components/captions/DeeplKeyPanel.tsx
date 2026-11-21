'use client';

/**
 * Caption settings → DeepL API key (AUN-CAPTIONS DEEPL-KEY). Super admins set, test and remove it;
 * every admin sees its state. Built like Costs → Connections: the key is typed once, sent to
 * admin-api (which seals and tests it) and cleared from the field. It is never pre-filled, echoed,
 * kept in state after the save or logged. The panel shows the last four characters, the plan (Free
 * for keys ending in ':fx'), who set it and when, and the last /v2/usage test.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateDeeplKey, type DeeplKeyView, type DeeplTestCode, type DeeplUsageResult } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { opsFormats } from '@/app/(protected)/operations/model';
import { keepTimeTogether } from '@/i18n/time-together';
import { ConfirmButton } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { cardClass, fieldClass } from '@/components/ui';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { removeDeeplKey, saveDeeplKey, testDeeplKey, type DeeplKeyResult } from '@/lib/api/captions';
import type { ActionResult } from '@/lib/api/errors';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';

type Feedback = { kind: 'ok' | 'error'; text: string } | null;
type State = 'set' | 'unset' | 'unreadable' | 'refused' | 'quota';
const KNOWN_CODES = ['forbidden', 'not_set', 'invalid_key', 'not_configured'] as const;
const EMPTY: DeeplKeyView = { set: false, last4: null, plan: null, updatedBy: null, updatedByName: null, updatedAt: null, test: null, source: null };

export const DEEPL_KEY_ANCHOR = 'deepl-key';

export function DeeplKeyPanel({ view, canManage }: { view: DeeplKeyView | null | undefined; canManage: boolean }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const key = view ?? EMPTY;
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fresh, setFresh] = useState<DeeplUsageResult | null>(null);

  // The newest test: one just made on this page, else the stored one
  const test: { ok: boolean; code: DeeplTestCode; characterCount: number | null; characterLimit: number | null } | null = fresh ?? key.test;
  // A key DeepL refused, or whose characters are used up, is shown as that, never as a healthy "Set"
  const state: State = !key.set ? 'unset' : key.unreadable ? 'unreadable' : test?.code === 'invalid' ? 'refused' : test?.code === 'quota' ? 'quota' : 'set';
  // The admin's shared formats, the same as the Costs page's DeepL line (compact counts, admin times)
  const f = opsFormats(locale);
  const n = (v: number) => f.count(v);
  const when = (iso: string) => keepTimeTogether(f.time(iso));

  function describe(result: Extract<ActionResult<unknown>, { ok: false }>, action: string): string {
    if (result.status === 401) return t('errors.notAuthenticated');
    if (result.code && (KNOWN_CODES as readonly string[]).includes(result.code)) return t(`captionSettings.deeplKey.errors.${result.code}` as MessageKey);
    if (result.status === 403) return t('captionSettings.deeplKey.errors.forbidden');
    const ref = reportError(new Error(`DeepL key ${action} failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
    return t('captionSettings.deeplKey.errors.failed', { ref });
  }

  async function run(action: 'save' | 'test' | 'remove', call: () => Promise<ActionResult<DeeplKeyResult>>, success: (data: DeeplKeyResult) => string): Promise<DeeplKeyResult | null> {
    setBusy(action);
    setFeedback(null);
    let result: ActionResult<DeeplKeyResult>;
    try {
      result = await call();
    } catch (error) {
      logger.error('[caption-settings] DeepL key request failed', { action, error: error instanceof Error ? error.message : String(error) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      if (result.status !== 0 && result.status < 500) logger.warn('[caption-settings] DeepL key change refused', { action, status: result.status, code: result.code });
      setFeedback({ kind: 'error', text: describe(result, action) });
      return null;
    }
    setFeedback({ kind: 'ok', text: success(result.data) });
    router.refresh();
    return result.data;
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const issue = validateDeeplKey(value);
    setProblem(issue);
    if (issue) return;
    const typed = value;
    const out = await run('save', () => saveDeeplKey(typed), (d) => (d.test?.ok ? t('captionSettings.deeplKey.saved') : t('captionSettings.deeplKey.savedTestFailed')));
    if (out) {
      setValue('');
      setFresh(out.test ?? null);
    }
  }

  async function retest() {
    const out = await run('test', testDeeplKey, () => t('captionSettings.deeplKey.tested'));
    if (out) setFresh(out.test ?? null);
  }

  const testLine = test ? testText(test) : null;
  function testText(r: NonNullable<typeof test>): string {
    const used = r.characterCount !== null ? n(r.characterCount) : null;
    const limit = r.characterLimit !== null ? n(r.characterLimit) : null;
    if (r.code === 'ok') return used !== null && limit !== null ? t('captionSettings.deeplKey.tests.ok', { used, limit }) : t('captionSettings.deeplKey.tests.okPlain');
    if (r.code === 'quota') return used !== null && limit !== null ? t('captionSettings.deeplKey.tests.quota', { used, limit }) : t('captionSettings.deeplKey.tests.quotaPlain');
    return t(`captionSettings.deeplKey.tests.${r.code}` as MessageKey);
  }

  const statusText =
    state === 'unset'
      ? t('captionSettings.deeplKey.status.unset')
      : state === 'unreadable'
        ? t('captionSettings.deeplKey.status.unreadable')
        : key.last4
          ? t(`captionSettings.deeplKey.status.${state}`, { last4: key.last4 })
          : t(`captionSettings.deeplKey.status.${state}Plain`);
  const tone = state === 'set' ? 'text-success-fg' : state === 'unset' ? 'text-fg-muted' : state === 'quota' ? 'text-warning-fg' : 'text-danger-fg';
  const who: React.ReactNode = key.updatedByName || (key.updatedBy ? <UserName id={key.updatedBy} showEmail={false} /> : null);

  return (
    <section id={DEEPL_KEY_ANCHOR} className={`${cardClass} scroll-mt-24`} aria-labelledby={`${ids}-title`} data-testid="deepl-key" data-state={state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg">{t('captionSettings.deeplKey.title')}</h2>
        {key.plan && key.set && !key.unreadable && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted" data-testid="deepl-key-plan">{t(`captionSettings.deeplKey.plan.${key.plan}`)}</span>
        )}
      </div>
      <p className="mt-1 max-w-3xl text-sm text-fg-muted">{t('captionSettings.deeplKey.intro')}</p>

      <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm text-fg" data-testid="deepl-key-status">
        <span aria-hidden="true" className={`text-base leading-none ${tone}`}>●</span>
        <span dir="auto">{statusText}</span>
      </p>
      {key.source === 'binding' && <p className="mt-2 text-sm text-fg-muted" data-testid="deepl-key-binding">{t('captionSettings.deeplKey.sourceBinding')}</p>}

      {(key.updatedAt || testLine) && (
        <div className="mt-3 space-y-1.5 rounded-md border border-border bg-surface-2 p-3 text-sm">
          {key.updatedAt && (
            <p className="text-fg-muted" data-testid="deepl-key-set-by">
              {who
                ? fillNodes(t('captionSettings.deeplKey.setBy', { time: when(key.updatedAt) }), { name: who })
                : t('captionSettings.deeplKey.setAt', { time: when(key.updatedAt) })}
            </p>
          )}
          {test && testLine && (
            <div data-testid="deepl-key-test-result" data-ok={test.ok ? 'true' : 'false'} data-code={test.code}>
              {key.test && !fresh && <p className="text-xs text-fg-muted">{t('captionSettings.deeplKey.lastTest', { time: when(key.test.at) })}</p>}
              <p className={`mt-0.5 flex items-start gap-1.5 ${test.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
                <span aria-hidden="true">{test.ok ? '✓' : '✕'}</span>
                <span>{testLine}</span>
              </p>
            </div>
          )}
        </div>
      )}

      {canManage ? (
        <div className="mt-4 space-y-3">
          {/* Only the key field is the form: Remove's confirm dialog has a form of its own */}
          <form id={`${ids}-form`} onSubmit={save} noValidate data-testid="deepl-key-form">
            <label htmlFor={`${ids}-key`} className="block text-sm font-medium text-fg">{t('captionSettings.deeplKey.keyLabel')}</label>
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
              className={`${fieldClass} mt-1 w-full max-w-xl font-mono ${problem ? 'border-danger-border' : ''}`}
              data-testid="deepl-key-input"
            />
            <span id={`${ids}-help`} className="mt-1 block text-xs text-fg-muted">{t(key.set ? 'captionSettings.deeplKey.keyHelp' : 'captionSettings.deeplKey.keyHelpFirst')}</span>
            {problem && (
              <span id={`${ids}-error`} className="mt-1 block text-xs text-danger-fg" data-testid="deepl-key-error">
                {t(`captionSettings.deeplKey.keyErrors.${problem === 'spaces' ? 'spaces' : 'shape'}`)}
              </span>
            )}
          </form>
          <div className="flex flex-wrap gap-2">
            <button type="submit" form={`${ids}-form`} className="inline-flex min-h-10 items-center justify-center rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-accent" disabled={busy !== null || value.trim() === ''} data-testid="deepl-key-save">
              {busy === 'save' ? t('content.working') : t('captionSettings.deeplKey.save')}
            </button>
            <button type="button" className={`${smallButtonClass} min-h-10`} disabled={busy !== null || !key.set} onClick={retest} data-testid="deepl-key-test">
              {busy === 'test' ? t('content.working') : t('captionSettings.deeplKey.test')}
            </button>
            <ConfirmButton
              label={t('captionSettings.deeplKey.remove')}
              title={t('captionSettings.deeplKey.removeTitle')}
              body={t('captionSettings.deeplKey.removeBody')}
              confirmLabel={t('captionSettings.deeplKey.remove')}
              danger
              disabled={!key.set}
              busy={busy === 'remove'}
              buttonClassName="min-h-10"
              testId="deepl-key-remove"
              onConfirm={async () => {
                const out = await run('remove', removeDeeplKey, () => t('captionSettings.deeplKey.removed'));
                if (out) setFresh(null);
              }}
            />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-fg-muted" data-testid="deepl-key-read-only">{t('captionSettings.deeplKey.readOnly')}</p>
      )}

      <div aria-live="polite" className="mt-3 min-h-5" data-testid="deepl-key-feedback">
        {feedback?.kind === 'error' && (
          <p role="alert" className="rounded border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg" data-testid="deepl-key-feedback-error">{feedback.text}</p>
        )}
        {feedback?.kind === 'ok' && <p className="text-sm text-success-fg" data-testid="deepl-key-feedback-ok">{feedback.text}</p>}
      </div>
    </section>
  );
}
