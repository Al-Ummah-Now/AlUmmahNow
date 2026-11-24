'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GovernedResult } from '@/lib/api/errors';
import { isUnexpectedFailure, tierActionMessage, TierChangeSent } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { smallButtonClass } from '@/components/content/parts';
import { useSentRequest } from '@/components/workflows/useSentRequest';
import { SentForApproval } from '@/components/workflows/SentForApproval';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

/** Server action (lib/api/creators setDefaultCreatorTier), passed down from the page. */
export type SetDefaultTierAction = (tierId: string, opts?: { undo?: boolean }) => Promise<GovernedResult<{ previous: string; defaultTierId: string }>>;

class DefaultTierFailure extends Error {
  constructor(readonly result: { status: number; code?: string }) {
    super(`Default tier change failed: ${result.status} ${result.code ?? ''}`.trim());
  }
}

/**
 * "Set as default": makes a tier the default at once, with Undo (owner rule:
 * undo instead of confirm). Only accounts that sign up afterwards get it
 * (every account stores its own tier); Undo puts the previous one back. When the
 * default tier's rule has approvers it is sent for approval instead: nothing to undo.
 */
export function DefaultTierButton({ tierId, tierName, label, setDefault, testId, pendingRequest }: { /** A default-tier change waiting for approval: no other can be asked for */ pendingRequest?: string; tierId: string; tierName: string; label: string; setDefault: SetDefaultTierAction; testId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const { run } = useUndoableAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useSentRequest(pendingRequest);

  async function call(id: string, undo = false) {
    const result = await setDefault(id, undo ? { undo: true } : undefined);
    if (result.ok === 'sent') throw new TierChangeSent(result.requestId);
    if (!result.ok) throw new DefaultTierFailure(result);
    return result.data;
  }

  async function onClick() {
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await run({
        action: () => call(tierId),
        undo: async (res) => {
          await call(res.previous, true);
          router.refresh();
        },
        message: t('creators.tierDefaultSet', { tier: tierName }),
        undoneMessage: t('creators.tierDefaultUndone'),
      });
      router.refresh();
    } catch (e) {
      if (e instanceof TierChangeSent) {
        setSent(e.requestId);
        router.refresh();
        return;
      }
      const result = e instanceof DefaultTierFailure ? e.result : { status: 0 };
      logger.warn('[creators] Default tier change failed', { tierId, status: result.status, code: (result as { code?: string }).code });
      if (isUnexpectedFailure(result)) reportError(e instanceof Error ? e : new Error(String(e)), { kind: 'fetch', status: result.status, shown: true });
      setError(t(tierActionMessage(result)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!pendingRequest && !sent && <button type="button" className={smallButtonClass} disabled={busy} onClick={() => void onClick()} data-testid={testId}>
        {label}
      </button>}
      {sent && <SentForApproval requestId={sent} testId={`${testId}-sent`} />}
      {error && (
        <span role="alert" className="text-xs text-danger-fg" data-testid={`${testId}-error`}>
          {error}
        </span>
      )}
    </span>
  );
}
