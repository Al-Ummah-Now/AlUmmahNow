'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreatorTier } from '@al-ummah/shared-types';
import type { GovernedResult } from '@/lib/api/errors';
import { arabicMissing, isUnexpectedFailure, tierActionMessage, TierChangeSent, tierLabel } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { cardClass } from '@/components/ui';
import { Chip, smallButtonClass } from '@/components/content/parts';
import { useSentRequest } from '@/components/workflows/useSentRequest';
import { SentForApproval, WaitingForApproval } from '@/components/workflows/SentForApproval';
import { useUndoableAction } from '@/components/undo/UndoToast';
import type { PendingRequest } from '@/lib/workflows';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

type Reorder = (ids: string[], opts?: { undo?: boolean }) => Promise<GovernedResult<{ previous: string[]; order: string[] }>>;

class ReorderFailure extends Error {
  constructor(readonly result: { status: number; code?: string }) {
    super(`Tier reorder failed: ${result.status} ${result.code ?? ''}`.trim());
  }
}

/**
 * The tiers' rank (owner, 2026-11-15): lowest first, the order of the Upgrade
 * page and every tier picker. Admins drag a row or use Move up / Move down
 * (keyboard); each change saves at once, audited, with Undo, or is sent for
 * approval when the rule has approvers (the list then waits for that request).
 */
export function TierRankList({ tiers, defaultTierId, canManage, reorder, pendingRequest }: { tiers: CreatorTier[]; defaultTierId?: string; canManage: boolean; reorder?: Reorder; /** An order waiting for approval */ pendingRequest?: PendingRequest }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const { run } = useUndoableAction();
  const [order, setOrder] = useState<string[]>(tiers.map((tier) => tier.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, send] = useSentRequest(pendingRequest);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const serverOrder = tiers.map((tier) => tier.id).join(',');
  useEffect(() => setOrder(serverOrder.split(',')), [serverOrder]);
  const byId = new Map(tiers.map((tier) => [tier.id, tier]));
  const editable = canManage && !!reorder && !pendingRequest && !sent;

  async function call(ids: string[], undo = false) {
    const result = await reorder!(ids, undo ? { undo: true } : undefined);
    if (result.ok === 'sent') throw new TierChangeSent(result.requestId);
    if (!result.ok) throw new ReorderFailure(result);
    return result.data;
  }

  async function save(next: string[], moved: string) {
    const before = order;
    setOrder(next);
    setBusy(true);
    setError(null);
    // The tier's name in the admin's language, and the rank in its digits («صارت «عالِم» رقم ٤»)
    const movedTier = byId.get(moved);
    const name = movedTier ? tierLabel(movedTier, locale) : moved;
    try {
      await run({
        action: () => call(next),
        undo: async (res) => {
          await call(res.previous, true);
          setOrder(res.previous);
          router.refresh();
        },
        message: t('creators.rankSaved', { tier: name, rank: formatNumber(next.indexOf(moved) + 1, locale) }),
        undoneMessage: t('creators.rankUndone'),
      });
      setAnnounce(t('creators.rankSaved', { tier: name, rank: String(next.indexOf(moved) + 1) }));
      router.refresh();
    } catch (e) {
      setOrder(before);
      if (e instanceof TierChangeSent) {
        send(e.requestId);
        return;
      }
      const result = e instanceof ReorderFailure ? e.result : { status: 0 };
      logger.warn('[creators] Tier reorder failed', { status: result.status });
      if (isUnexpectedFailure(result)) reportError(e instanceof Error ? e : new Error(String(e)), { kind: 'fetch', status: result.status, shown: true });
      setError(t(tierActionMessage(result)));
    } finally {
      setBusy(false);
    }
  }

  const move = (id: string, by: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    void save(next, id);
  };
  const dropOn = (target: string) => {
    if (!dragging || dragging === target) return;
    const next = order.filter((id) => id !== dragging);
    next.splice(next.indexOf(target) + (order.indexOf(dragging) < order.indexOf(target) ? 1 : 0), 0, dragging);
    void save(next, dragging);
  };

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="tiers-rank-title" data-testid="tiers-rank">
      <h2 id="tiers-rank-title" className="text-lg font-semibold text-fg mb-1">{t('creators.rankTitle')}</h2>
      <p className="text-sm text-fg-muted mb-3 max-w-3xl">{t('creators.rankBody')}{editable ? ` ${t('creators.rankHow')}` : ''}</p>
      {sent ? <SentForApproval requestId={sent} testId="tiers-rank-sent" className="mb-3" /> : canManage && pendingRequest ? <WaitingForApproval requestId={pendingRequest} testId="tiers-rank-waiting" className="mb-3" /> : null}
      <ol className="flex flex-col gap-2" data-testid="tiers-rank-list" data-order={order.join(',')}>
        {order.map((id, i) => {
          const tier = byId.get(id);
          if (!tier) return null;
          return (
            <li
              key={id}
              draggable={editable && !busy}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => editable && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(id);
                setDragging(null);
              }}
              className={`flex items-center gap-2 rounded border border-border bg-surface px-3 py-2 ${dragging === id ? 'opacity-60' : ''} ${editable ? 'cursor-grab' : ''}`}
              data-testid={`tiers-rank-${id}`}
            >
              {editable && <span aria-hidden="true" className="select-none text-fg-muted">⋮⋮</span>}
              <span className="w-6 shrink-0 text-sm text-fg-muted tabular-nums">{formatNumber(i + 1, locale)}</span>
              {/* Name and chips wrap among themselves; the move buttons keep their place on the row */}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{tierLabel(tier, locale)}</span>
                {id === defaultTierId && <Chip tone="info">{t('creators.tierDefaultChip')}</Chip>}
                {tier.hidden && <Chip tone="neutral" testId={`tiers-rank-${id}-hidden`}>{t('creators.hiddenChip')}</Chip>}
                {arabicMissing(tier) && <Chip tone="warn" testId={`tiers-rank-${id}-arabic-missing`}>{t('creators.arabicMissing')}</Chip>}
              </span>
              {editable && (
                <span className="ms-auto flex shrink-0 gap-1">
                  <button type="button" className={smallButtonClass} disabled={busy || i === 0} onClick={() => move(id, -1)} aria-label={t('creators.rankMoveUp', { tier: tierLabel(tier, locale) })} data-testid={`tiers-rank-${id}-up`}>
                    ↑
                  </button>
                  <button type="button" className={smallButtonClass} disabled={busy || i === order.length - 1} onClick={() => move(id, 1)} aria-label={t('creators.rankMoveDown', { tier: tierLabel(tier, locale) })} data-testid={`tiers-rank-${id}-down`}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger-fg" data-testid="tiers-rank-error">{error}</p>}
    </section>
  );
}
