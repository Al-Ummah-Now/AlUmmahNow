'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CREATOR_TIER_IDS, creatorTierOrigin, type CreatorTier, type CreatorTierAssignment, type CreatorTierOrigin } from '@al-ummah/shared-types';
import { defaultTierName, isUnexpectedFailure, ORIGIN_LABEL, tierActionMessage, tierChangeMessage, tierLabel } from '@/lib/creator-tiers';
import type { GovernedResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { type MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { Chip, smallButtonClass } from '@/components/content/parts';
import type { PendingRequest } from '@/lib/workflows';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { useSentRequest } from '@/components/workflows/useSentRequest';
import { SentForApproval, WaitingForApproval } from '@/components/workflows/SentForApproval';
import { TierChangeDialog } from './TierChangeDialog';
import { useNames } from '@/components/audit/useNames';
import { Select } from '@/components/select/Select';

import { LocalTime } from '@/components/LocalTime';
export interface CurrentTier {
  tierId: string;
  origin: CreatorTierOrigin;
  assignedBy: string;
  assignedByName?: string | null;
  assignedAt: string;
}

/** setUserCreatorTier (lib/api/creators), passed down from the server page. */
export type SetTierAction = (userId: string, tierId: string | null, opts?: { confirmSuperAdmin?: boolean }) => Promise<GovernedResult<unknown>>;

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
  /** A change of this user's tier waiting for approval */
  pendingRequest?: PendingRequest;
  /** How wide the approval notices may be (the Users table's phone column is narrow) */
  noticeClassName?: string;
}

/** Fills a "{actor}, {date}" template with each value in its own <bdi>. */
/** "Assigned by <name>, <date>" for an admin known by id; "Assigned by an admin, <date>" until (or unless) the name is known. */
function AssignedBy({ id, date }: { id: string | null; date: React.ReactNode }) {
  const { t } = useLanguage();
  const names = useNames(id ? [{ kind: 'user', id }] : []);
  const person = id ? names.users[id] : undefined;
  const name = person?.found ? person.name?.trim() : '';
  return <>{name ? withIsolated(t('creators.assignedByActor'), { actor: name, date }) : withIsolated(t('creators.assignedByAdmin'), { actor: '', date })}</>;
}

function withIsolated(template: string, values: Record<string, React.ReactNode>): React.ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in values ? <bdi key={i}>{values[name]}</bdi> : part;
  });
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: MessageKey };

/**
 * A user's creator tier: what they hold, where it came from (who assigned it
 * and when), and a select to change it. Every change opens a confirmation
 * stating its effect; it takes effect at once (the tier is read on every API
 * call) and the user is told (in-app notice + email, api-videos lib/tierChanges.ts). A super admin's
 * automatic Unlimited is locked, with the reason shown; "Change anyway"
 * unlocks it for a deliberate change (admin-api also refuses it otherwise).
 */
export function CreatorTierControl({ userId, userName, current: serverCurrent, tiers, canManage, needsTier = false, testId = 'creator-tier', setTier, pendingRequest, noticeClassName }: CreatorTierControlProps) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  // undefined: no change pending; string: assign that tier (every account keeps a tier: no "remove")
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [unlocked, setUnlocked] = useState(false);
  const [sent, send] = useSentRequest(pendingRequest);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // The tier just saved, shown at once: the page's refresh (router.refresh) re-reads the whole list
  // and can take seconds, and until it lands the row showed the old tier under "Saved". Dropped as
  // soon as the server's value changes (the refresh arrived, or another change came in).
  const [saved, setSaved] = useState<{ basis: string | null; tier: CurrentTier | null } | null>(null);
  const current = saved && saved.basis === (serverCurrent?.tierId ?? null) ? saved.tier : serverCurrent;
  const superAdmin = current?.origin === 'super_admin';
  const locked = superAdmin && !unlocked;
  // A change waiting for approval holds the tier until it is decided
  const changeable = canManage && !pendingRequest && !sent;
  const tierOf = (id: string | null | undefined) => (id ? tiers.find((tier) => tier.id === id) ?? null : null);
  const currentTier = tierOf(current?.tierId);
  // Every account has a stored tier; one not backfilled yet works as Free, so it is shown as Free
  const freeTier = tiers.find((tier) => tier.id === CREATOR_TIER_IDS.member);
  const currentName = current ? (currentTier ? tierLabel(currentTier, locale) : current.tierId) : freeTier ? tierLabel(freeTier, locale) : defaultTierName(CREATOR_TIER_IDS.member, tiers, t, locale);

  async function apply(tierId: string) {
    setPending(undefined);
    setStatus({ kind: 'saving' });
    let result: GovernedResult<unknown>;
    try {
      result = await setTier(userId, tierId, { confirmSuperAdmin: superAdmin });
    } catch (error) {
      result = { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok === 'sent') {
      setStatus({ kind: 'idle' });
      setUnlocked(false);
      send(result.requestId);
      return;
    }
    if (!result.ok) {
      logger.warn('[creators] Tier change failed', { userId, status: result.status, code: result.code });
      if (isUnexpectedFailure(result)) reportError(new Error(`Creator tier change failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
      setStatus({ kind: 'failed', message: tierActionMessage(result) });
      return;
    }
    const assignment = (result.data as { assignment?: CreatorTierAssignment | null } | undefined)?.assignment;
    setSaved({
      basis: serverCurrent?.tierId ?? null,
      tier: {
        tierId,
        origin: (assignment && creatorTierOrigin(assignment)) || 'admin',
        assignedBy: assignment?.assignedBy ?? '',
        assignedByName: null,
        assignedAt: assignment?.assignedAt ?? new Date().toISOString(),
      },
    });
    setStatus({ kind: 'saved' });
    setUnlocked(false);
    router.refresh();
  }

  const next = pending === undefined ? null : tierOf(pending);
  const warning = superAdmin ? t('creators.superAdminOverrideWarning') : null;

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
          {/* Who and when once: "Assigned by Amina Hassan, 16 November 2026" (an admin without a name: "Assigned by an
              admin, …"); names and dates isolated, so an English name in Arabic does not scramble the line */}
          {current.origin === 'admin'
            ? current.assignedByName
              ? withIsolated(t('creators.assignedByActor'), { actor: current.assignedByName, date: <LocalTime value={current.assignedAt} /> })
              // Only the id stored (the user page): the admin's name once looked up, else "an admin", never a raw id
              : <AssignedBy id={current.assignedBy ?? null} date={<LocalTime value={current.assignedAt} />} />
            : current.origin === 'super_admin'
              ? t(ORIGIN_LABEL[current.origin])
              : withIsolated(t('creators.originOn'), { origin: t(ORIGIN_LABEL[current.origin]), date: <LocalTime value={current.assignedAt} /> })}
        </p>
      )}
      {superAdmin && <p className="text-xs text-fg-muted max-w-xs" data-testid={`${testId}-super-admin`}>{t('creators.superAdminLocked')}</p>}

      {sent ? <SentForApproval requestId={sent} testId={`${testId}-sent`} className={noticeClassName} /> : canManage && pendingRequest ? <WaitingForApproval requestId={pendingRequest} testId={`${testId}-waiting`} className={noticeClassName} /> : null}
      {changeable && !locked && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('creators.changeTierFor', { name: userName })}
            data-testid={`${testId}-select`}
            value={pending === undefined ? current?.tierId ?? '' : pending ?? ''}
            disabled={status.kind === 'saving'}
            onChange={(e) => {
              const value = e.target.value;
              if (!value || value === current?.tierId) return;
              setStatus({ kind: 'idle' });
              setPending(value);
            }}
            className={`${fieldClass} py-1 text-sm`}
          >
            {/* Not backfilled yet: no stored tier to select (works as Free) */}
            {!current && <option value="" disabled>{currentName}</option>}
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>{tier.hidden ? `${tierLabel(tier, locale)} (${t('creators.hiddenChip')})` : tierLabel(tier, locale)}</option>
            ))}
          </Select>
          {needsTier && !current && tiers.some((tier) => tier.id === CREATOR_TIER_IDS.creator) && (
            <button type="button" className={smallButtonClass} disabled={status.kind === 'saving'} onClick={() => setPending(CREATOR_TIER_IDS.creator)} data-testid="creator-assign-creator">
              {t('creators.assignCreator')}
            </button>
          )}
        </div>
      )}
      {changeable && locked && (
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
        title={t('creators.confirmAssignTitle')}
        body={tierChangeMessage(next, t, locale, { userName })}
        warning={warning}
        confirmLabel={t('creators.assignTier', { tier: next?.name ?? '' })}
        danger={superAdmin}
        testId={`${testId}-change`}
        onCancel={() => setPending(undefined)}
        onConfirm={() => pending && void apply(pending)}
      />
    </div>
  );
}
