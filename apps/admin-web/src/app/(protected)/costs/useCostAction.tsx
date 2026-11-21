'use client';

/**
 * Runs one Costs change (a server action from lib/api/costs.ts): a translated error for the
 * admin-api code, an Errors page report with its reference for unexpected failures, and a page
 * refresh on success so the server sections show the new state.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import type { ActionResult } from '@/lib/api/errors';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';

const KNOWN_CODES = ['forbidden', 'not_set', 'invalid_key', 'no_email', 'not_configured', 'not_ready', 'bad_request', 'too_many', 'not_found'] as const;

export type Feedback = { kind: 'ok' | 'error'; text: string } | null;

export function useCostAction(scope: string) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function describe(result: Extract<ActionResult<unknown>, { ok: false }>, name: string): string {
    if (result.status === 401) return t('errors.notAuthenticated');
    if (result.code && (KNOWN_CODES as readonly string[]).includes(result.code)) return t(`costs.errors.${result.code}` as MessageKey);
    if (result.status === 403) return t('costs.errors.forbidden');
    if (result.status === 0 || result.status >= 500) {
      const ref = reportError(new Error(`Costs ${scope} ${name} failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
      return t('costs.errors.failed', { ref });
    }
    return t('costs.errors.bad_request');
  }

  /** Runs the change; its data, or null when it failed (the error is shown). */
  async function run<T>(name: string, action: () => Promise<ActionResult<T>>, success?: (data: T) => string): Promise<T | null> {
    setBusy(name);
    setFeedback(null);
    let result: ActionResult<T>;
    try {
      result = await action();
    } catch (error) {
      logger.error('[costs] Action request failed', { scope, name, error: error instanceof Error ? error.message : String(error) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      if (result.status !== 0 && result.status < 500) logger.warn('[costs] Action refused', { scope, name, status: result.status, code: result.code });
      setFeedback({ kind: 'error', text: describe(result, name) });
      return null;
    }
    if (success) setFeedback({ kind: 'ok', text: success(result.data) });
    router.refresh();
    return result.data;
  }

  return { run, busy, feedback, setFeedback };
}

/** The outcome of the last change, announced politely. */
export function FeedbackLine({ feedback, testId }: { feedback: Feedback; testId: string }) {
  return (
    <div aria-live="polite" data-testid={testId} className="min-h-5">
      {feedback?.kind === 'error' && (
        <p role="alert" className="rounded border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg" data-testid={`${testId}-error`}>
          {feedback.text}
        </p>
      )}
      {feedback?.kind === 'ok' && (
        <p className="text-sm text-success-fg" data-testid={`${testId}-ok`}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}
