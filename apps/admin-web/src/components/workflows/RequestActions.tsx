'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORKFLOW_LIMITS, type WorkflowRequestView, type WorkflowStatus } from '@al-ummah/shared-types';
import { ConfirmButton } from '@/components/content/actions';
import { fieldClass, secondaryButtonClass } from '@/components/ui';
import { useLanguage } from '@/i18n/I18nProvider';
import type { ActionResult } from '@/lib/api/errors';
import { logger } from '@/lib/logger-client';

/** Server actions (lib/api/workflows), passed down from the page. */
export interface RequestActionCalls {
  approve: (id: string, version: number, note: string) => Promise<ActionResult<WorkflowRequestView>>;
  reject: (id: string, version: number, reason: string) => Promise<ActionResult<WorkflowRequestView>>;
  withdraw: (id: string, version: number) => Promise<ActionResult<WorkflowRequestView>>;
  retry: (id: string) => Promise<ActionResult<WorkflowRequestView>>;
  comment: (id: string, note: string) => Promise<ActionResult<WorkflowRequestView>>;
}

type Kind = 'approve' | 'reject' | 'withdraw' | 'retry' | 'comment';

interface Props {
  id: string;
  version: number;
  title: string;
  status: WorkflowStatus;
  can: { approve: boolean; reject: boolean; withdraw: boolean };
  canRetry: boolean;
  actions: RequestActionCalls;
}

/**
 * Approve, Reject (reason required), Withdraw, Retry and Comment on one request. Every decision asks in
 * the in-app dialog (never a browser prompt); admin-api runs the step-up when the rule asks for it and
 * answers in the reader's language when it refuses.
 */
export function RequestActions({ id, version, title, status, can, canRetry, actions }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [comment, setComment] = useState('');

  async function run(kind: Kind, call: () => Promise<ActionResult<unknown>>) {
    setBusy(kind);
    setMessage(null);
    try {
      const result = await call();
      if (result.ok) {
        setMessage({ tone: 'ok', text: t(`workflows.done.${kind}`) });
        if (kind === 'comment') setComment('');
      } else {
        if (result.status >= 500) logger.error('[approvals] Action failed', { id, kind, status: result.status, code: result.code });
        // admin-api writes the refusal in the reader's language (FEAT-3 envelope)
        setMessage({ tone: 'error', text: result.status < 500 && result.error ? result.error : t('workflows.failed') });
      }
    } catch (e) {
      logger.error('[approvals] Action request failed', { id, kind, error: e instanceof Error ? e.message : String(e) });
      setMessage({ tone: 'error', text: t('workflows.failed') });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-2">
        {can.withdraw && (
          <ConfirmButton
            label={t('workflows.withdraw')}
            busy={busy === 'withdraw'}
            disabled={busy !== null}
            buttonClassName="min-h-11 sm:min-h-0"
            title={t('workflows.withdrawTitle')}
            body={t('workflows.withdrawBody')}
            confirmLabel={t('workflows.withdraw')}
            testId="approval-withdraw"
            onConfirm={() => run('withdraw', () => actions.withdraw(id, version))}
          />
        )}
        {canRetry && (
          <ConfirmButton
            label={t('workflows.retry')}
            busy={busy === 'retry'}
            disabled={busy !== null}
            buttonClassName="min-h-11 sm:min-h-0"
            title={t('workflows.retryTitle')}
            body={t('workflows.retryBody')}
            confirmLabel={t('workflows.retry')}
            testId="approval-retry"
            onConfirm={() => run('retry', () => actions.retry(id))}
          />
        )}
        {status === 'pending' && can.reject && (
          <ConfirmButton
            label={t('workflows.reject')}
            busy={busy === 'reject'}
            disabled={busy !== null}
            danger
            withReason
            reasonMaxLength={WORKFLOW_LIMITS.maxReasonLength}
            reasonHint={t('workflows.rejectHint')}
            buttonClassName="min-h-11 sm:min-h-0"
            title={t('workflows.rejectTitle', { title })}
            body={t('workflows.rejectBody')}
            confirmLabel={t('workflows.reject')}
            testId="approval-reject"
            onConfirm={(reason) => run('reject', () => actions.reject(id, version, reason))}
          />
        )}
        {status === 'pending' && can.approve && (
          <ConfirmButton
            label={t('workflows.approve')}
            busy={busy === 'approve'}
            disabled={busy !== null}
            primary
            buttonClassName="min-h-11 sm:min-h-0"
            title={t('workflows.approveTitle', { title })}
            body={t('workflows.approveBody')}
            confirmLabel={t('workflows.approve')}
            testId="approval-approve"
            onConfirm={() => run('approve', () => actions.approve(id, version, ''))}
          />
        )}
      </div>
      <form
        className="flex flex-col gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (comment.trim()) void run('comment', () => actions.comment(id, comment));
        }}
      >
        <label htmlFor={`approval-comment-${id}`} className="text-sm font-medium text-fg">
          {t('workflows.commentLabel')}
        </label>
        <textarea
          id={`approval-comment-${id}`}
          className={`${fieldClass} min-h-20`}
          value={comment}
          maxLength={WORKFLOW_LIMITS.maxNoteLength}
          dir="auto"
          onChange={(e) => setComment(e.target.value)}
          data-testid="approval-comment-input"
        />
        <div className="flex justify-end">
          <button type="submit" className={`${secondaryButtonClass} min-h-11 sm:min-h-0`} disabled={busy !== null || !comment.trim()} data-testid="approval-comment-send">
            {t('workflows.commentSend')}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite" className={`text-sm ${message?.tone === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`} data-testid="approval-message">
        {message?.text}
      </p>
    </div>
  );
}
