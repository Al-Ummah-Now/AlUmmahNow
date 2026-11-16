'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TIER_REQUEST_LIMITS } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { decisionFailure } from '@/lib/tier-requests';
import { useLanguage } from '@/i18n/I18nProvider';
import { ConfirmButton } from '@/components/content/actions';
import { logger } from '@/lib/logger-client';

/** Server actions (lib/api/tier-requests), passed down from the page. */
export interface TierRequestDecisions {
  approve: (id: string) => Promise<ActionResult<unknown>>;
  decline: (id: string, reason: string) => Promise<ActionResult<unknown>>;
}

interface Props {
  id: string;
  name: string;
  tier: string;
  actions: TierRequestDecisions;
}

/** Approve (assigns the tier) or Decline (optional reason, shown to the user) one pending request. */
export function TierRequestActions({ id, name, tier, actions }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function run(kind: 'approve' | 'decline', reason = '') {
    setBusy(kind);
    setMessage(null);
    try {
      const result = kind === 'approve' ? await actions.approve(id) : await actions.decline(id, reason);
      if (result.ok) {
        setMessage({ tone: 'ok', text: kind === 'approve' ? t('tierRequests.approved', { name, tier }) : t('tierRequests.declinedDone') });
      } else {
        const failure = decisionFailure(result);
        if (failure === 'failed') logger.error('[tier-requests] Decision failed', { id, kind, status: result.status, code: result.code });
        setMessage({ tone: 'error', text: t(`tierRequests.${failure}`) });
      }
    } catch (e) {
      logger.error('[tier-requests] Decision request failed', { id, kind, error: e instanceof Error ? e.message : String(e) });
      setMessage({ tone: 'error', text: t('tierRequests.failed') });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    // The card's actions sit at its end edge on every width (owner rule: card buttons end-aligned)
    <div className="flex flex-col items-end gap-2 ms-auto">
      <div className="flex flex-wrap justify-end gap-2">
        <ConfirmButton
          label={t('tierRequests.approve')}
          busy={busy === 'approve'}
          disabled={busy !== null}
          primary
          buttonClassName="min-h-11 sm:min-h-0"
          title={t('tierRequests.approveTitle', { name, tier })}
          body={t('tierRequests.approveBody')}
          confirmLabel={t('tierRequests.approve')}
          testId={`tier-request-approve-${id}`}
          dialogTestId="tier-request-approve"
          onConfirm={() => run('approve')}
        />
        <ConfirmButton
          label={t('tierRequests.decline')}
          busy={busy === 'decline'}
          disabled={busy !== null}
          danger
          withReason
          reasonMaxLength={TIER_REQUEST_LIMITS.declineReason.max}
          reasonHint={t('tierRequests.declineReasonHint')}
          buttonClassName="min-h-11 sm:min-h-0"
          title={t('tierRequests.declineTitle', { name, tier })}
          body={t('tierRequests.declineBody')}
          confirmLabel={t('tierRequests.decline')}
          testId={`tier-request-decline-${id}`}
          dialogTestId="tier-request-decline"
          onConfirm={(reason) => run('decline', reason)}
        />
      </div>
      <p role="status" aria-live="polite" className={`text-sm ${message?.tone === 'error' ? 'text-danger-fg' : 'text-fg-muted'}`} data-testid={`tier-request-message-${id}`}>
        {message?.text}
      </p>
    </div>
  );
}
