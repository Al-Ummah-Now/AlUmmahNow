'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CREATOR_TIER_IDS, type CreatorTier, type CreatorTierOrigin } from '@al-ummah/shared-types';
import { isUnexpectedFailure, ORIGIN_LABEL, tierActionMessage, tierChangeMessage } from '@/lib/creator-tiers';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { Chip, smallButtonClass } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { TierChangeDialog } from './TierChangeDialog';

export interface CurrentTier {
  tierId: string;
  origin: CreatorTierOrigin;
  assignedBy: string;
  assignedByName?: string | null;
  assignedAt: string;
}

/** setUserCreatorTier (lib/api/creators), passed down from the server page. */
export type SetTierAction = (userId: string, tierId: string | null, opts?: { confirmSuperAdmin?: boolean }) => Promise<ActionResult<unknown>>;

export interface CreatorTierControlProps {
  userId: string;
  /** Shown in the confirmation ("Give Amina the Creator tier?") */
  userName: string;
  current: CurrentTier | null;
  tiers: CreatorTier[];
  canManage: boolean;
  /** Owns a channel or uploaded but has no tier: offers "Make Creator" */
  needsTier?: boolean;
  testId?: string;
  setTier: SetTierAction;
}

/** Fills a "{actor}, {date}" template with each value in its own <bdi>. */
function withIsolated(template: string, values: Record<string, string>): React.ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in values ? <bdi key={i}>{values[name]}</bdi> : part;
  });
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: MessageKey };

/**
 * A user's creator tier: what they hold, where it came from (who assigned it
 * and when), and a select to change it. Every change opens a confirmation
 * stating its effect; it applies to the user's next request. A super admin's
 * automatic Unlimited is locked, with the reason shown; "Change anyway"
 * unlocks it for a deliberate change (admin-api also refuses it otherwise).
 */
export function CreatorTierControl({ userId, userName, current, tiers, canManage, needsTier = false, testId = 'creator-tier', setTier }: CreatorTierControlProps) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  // undefined: no change pending; null: remove the tier; string: assign that tier
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const superAdmin = current?.origin === 'super_admin';
  const locked = superAdmin && !unlocked;
  const tierOf = (id: string | null | undefined) => (id ? tiers.find((tier) => tier.id === id) ?? null : null);
  const currentTier = tierOf(current?.tierId);
  const currentName = current ? currentTier?.name ?? current.tierId : t('creators.none');

  async function apply(tierId: string | null) {
    setPending(undefined);
    setStatus({ kind: 'saving' });
    let result: ActionResult<unknown>;
    try {
      result = await setTier(userId, tierId, { confirmSuperAdmin: superAdmin });
    } catch (error) {
      result = { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) {
      logger.warn('[creators] Tier change failed', { userId, status: result.status, code: result.code });
      if (isUnexpectedFailure(result)) reportError(new Error(`Creator tier change failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
      setStatus({ kind: 'failed', message: tierActionMessage(result) });
      return;
    }
    setStatus({ kind: 'saved' });
    setUnlocked(false);
    router.refresh();
  }

  const next = pending === undefined ? null : tierOf(pending);
  const removing = pending === null;
  const warning = superAdmin ? t('creators.superAdminOverrideWarning') : removing && current ? t('creators.removeWarning') : null;

  return (
    <div className="flex flex-col gap-2 min-w-48" data-testid={testId} data-user-id={userId} data-tier={current?.tierId ?? ''} data-origin={current?.origin ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={!current ? (needsTier ? 'warn' : 'neutral') : currentTier?.unlimited ? 'info' : 'good'} testId={`${testId}-chip`}>
          {currentName}
        </Chip>
        {needsTier && !current && <Chip tone="warn" testId="creator-needs-tier">{t('creators.needsTier')}</Chip>}
      </div>
      {current && (
        <p className="text-xs text-fg-muted" data-testid={`${testId}-origin`}>
          {t(ORIGIN_LABEL[current.origin])}
          {current.origin !== 'super_admin' && (
            <>
              {' · '}
              {/* Names and dates in their own direction, so an English name in Arabic does not scramble the line */}
              {withIsolated(t('creators.assignedByOn'), {
                actor: current.assignedByName || current.assignedBy,
                date: formatDate(current.assignedAt, locale),
              })}
            </>
          )}
        </p>
      )}
      {superAdmin && <p className="text-xs text-fg-muted max-w-xs" data-testid={`${testId}-super-admin`}>{t('creators.superAdminLocked')}</p>}

      {canManage && !locked && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('creators.changeTierFor', { name: userName })}
            data-testid={`${testId}-select`}
            value={pending === undefined ? current?.tierId ?? '' : pending ?? ''}
            disabled={status.kind === 'saving'}
            onChange={(e) => {
              const value = e.target.value || null;
              if (value === (current?.tierId ?? null)) return;
              setStatus({ kind: 'idle' });
              setPending(value);
            }}
            className={`${fieldClass} py-1 text-sm`}
          >
            <option value="">{t('creators.noTier')}</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>{tier.name}</option>
            ))}
          </select>
          {needsTier && !current && tiers.some((tier) => tier.id === CREATOR_TIER_IDS.creator) && (
            <button type="button" className={smallButtonClass} disabled={status.kind === 'saving'} onClick={() => setPending(CREATOR_TIER_IDS.creator)} data-testid="creator-assign-creator">
              {t('creators.assignCreator')}
            </button>
          )}
        </div>
      )}
      {canManage && locked && (
        <button type="button" className={`${smallButtonClass} self-start`} onClick={() => setUnlocked(true)} data-testid={`${testId}-unlock`}>
          {t('creators.changeAnyway')}
        </button>
      )}

      <p role="status" aria-live="polite" className="text-xs min-h-4" data-testid={`${testId}-status`} data-state={status.kind}>
        {status.kind === 'saving' && <span className="text-fg-muted">{t('creators.saving')}</span>}
        {status.kind === 'saved' && <span className="text-success-fg">{t('creators.saved')}</span>}
        {status.kind === 'failed' && <span className="text-danger-fg">{t(status.message)}</span>}
      </p>

      <TierChangeDialog
        open={pending !== undefined}
        title={removing ? t('creators.confirmRemoveTitle') : t('creators.confirmAssignTitle')}
        body={tierChangeMessage(removing ? null : next, t, locale, { userName })}
        warning={warning}
        confirmLabel={removing ? t('creators.removeTier') : t('creators.assignTier', { tier: next?.name ?? '' })}
        danger={removing || superAdmin}
        testId={`${testId}-change`}
        onCancel={() => setPending(undefined)}
        onConfirm={() => void apply(pending ?? null)}
      />
    </div>
  );
}
